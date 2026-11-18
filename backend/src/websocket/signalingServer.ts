import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { inMemoryDb } from '../database/supabaseClient';
import { DeviceService } from '../services/deviceService';

interface ClientSession {
  ws: WebSocket;
  type: 'agent' | 'viewer';
  role?: string;
  userId?: string;
  agentId?: string;
  organizationId: string;
  deviceId?: string;
  canControl: boolean;
  canView: boolean;
}

export class SignalingServer {
  private wss: WebSocketServer;
  private deviceRooms: Map<string, { agent?: ClientSession; viewers: Set<ClientSession> }> = new Map();

  constructor(server: HttpServer) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.initialize();
  }

  private initialize() {
    this.wss.on('connection', (ws: WebSocket, req) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const token = url.searchParams.get('token');
      const requestedDeviceId = url.searchParams.get('deviceId');

      if (!token) {
        ws.send(JSON.stringify({ type: 'error', message: 'Authentication required: missing token parameter.' }));
        ws.close(4001, 'Unauthorized');
        return;
      }

      let session: ClientSession;

      try {
        const decoded = jwt.verify(token, config.jwtSecret) as any;

        if (decoded.type === 'agent') {
          // Connected agent
          session = {
            ws,
            type: 'agent',
            agentId: decoded.agentId,
            organizationId: decoded.organizationId,
            canControl: true,
            canView: true,
          };
          this.handleAgentConnection(session);
        } else if (decoded.type === 'share_session') {
          // Public device share viewer
          session = {
            ws,
            type: 'viewer',
            role: 'share_viewer',
            organizationId: decoded.organizationId,
            deviceId: decoded.deviceId,
            canControl: !!decoded.allowControl,
            canView: true,
          };
          this.handleViewerConnection(session, decoded.deviceId);
        } else {
          // Authenticated dashboard user (customer, admin, assigned_user)
          const profile = inMemoryDb.profiles.get(decoded.id);
          if (!profile) {
            ws.close(4001, 'User profile not found');
            return;
          }

          if (!requestedDeviceId) {
            ws.send(JSON.stringify({ type: 'error', message: 'deviceId parameter required for device stream.' }));
            ws.close(4002, 'Missing deviceId');
            return;
          }

          // Check permissions via DeviceService
          const access = DeviceService.getDeviceById(requestedDeviceId, {
            id: profile.id,
            email: profile.email,
            system_role: profile.system_role,
            organizationId: decoded.organizationId || '',
          });

          if (access.status !== 200 || !access.device) {
            ws.send(JSON.stringify({ type: 'error', message: access.error || 'Access denied to this device.' }));
            ws.close(4003, 'Forbidden');
            return;
          }

          session = {
            ws,
            type: 'viewer',
            role: profile.system_role,
            userId: profile.id,
            organizationId: access.device.organization_id,
            deviceId: requestedDeviceId,
            canControl: access.permissions?.can_control ?? false,
            canView: access.permissions?.can_view ?? true,
          };

          this.handleViewerConnection(session, requestedDeviceId);
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid or expired token.' }));
        ws.close(4001, 'Unauthorized');
      }
    });

    console.log('[SignalingServer] WebSocket Signaling and Streaming gateway initialized on /ws');
  }

  private getRoom(deviceId: string) {
    if (!this.deviceRooms.has(deviceId)) {
      this.deviceRooms.set(deviceId, { viewers: new Set() });
    }
    return this.deviceRooms.get(deviceId)!;
  }

  private handleAgentConnection(session: ClientSession) {
    console.log(`[SignalingServer] Agent connected: ${session.agentId} (Org: ${session.organizationId})`);

    session.ws.on('message', (data: Buffer | string) => {
      try {
        // Can be text signaling message or binary video frame
        if (typeof data !== 'string' && !(data instanceof String)) {
          // Binary message: Video frame stream from scrcpy streaming bridge
          // Forward binary video data to all active viewers for this device
          if (session.deviceId) {
            const room = this.getRoom(session.deviceId);
            for (const viewer of room.viewers) {
              if (viewer.ws.readyState === WebSocket.OPEN) {
                viewer.ws.send(data);
              }
            }
          }
          return;
        }

        const msg = JSON.parse(data.toString());

        switch (msg.type) {
          case 'agent-register-device': {
            // Agent registers as producer for deviceId
            const deviceId = msg.deviceId;
            session.deviceId = deviceId;
            const room = this.getRoom(deviceId);
            room.agent = session;
            DeviceService.updateStatus(deviceId, 'online');
            session.ws.send(JSON.stringify({ type: 'registered', deviceId, success: true }));
            console.log(`[SignalingServer] Agent registered producer for device ${deviceId}`);
            break;
          }

          case 'webrtc-offer':
          case 'webrtc-answer':
          case 'ice-candidate': {
            // Forward WebRTC signaling to viewers
            if (session.deviceId) {
              const room = this.getRoom(session.deviceId);
              for (const viewer of room.viewers) {
                if (viewer.ws.readyState === WebSocket.OPEN) {
                  viewer.ws.send(JSON.stringify(msg));
                }
              }
            }
            break;
          }

          case 'stream-metrics': {
            // Device screen resolution, FPS, bitrate updates
            if (session.deviceId) {
              const room = this.getRoom(session.deviceId);
              for (const viewer of room.viewers) {
                if (viewer.ws.readyState === WebSocket.OPEN) {
                  viewer.ws.send(JSON.stringify(msg));
                }
              }
            }
            break;
          }
        }
      } catch (err) {
        console.error('[SignalingServer] Error handling agent message:', err);
      }
    });

    session.ws.on('close', () => {
      console.log(`[SignalingServer] Agent disconnected: ${session.agentId}`);
      if (session.deviceId) {
        const room = this.getRoom(session.deviceId);
        if (room.agent === session) {
          room.agent = undefined;
          DeviceService.updateStatus(session.deviceId, 'offline');
          for (const viewer of room.viewers) {
            viewer.ws.send(JSON.stringify({ type: 'device-offline', deviceId: session.deviceId }));
          }
        }
      }
    });
  }

  private handleViewerConnection(session: ClientSession, deviceId: string) {
    const room = this.getRoom(deviceId);
    room.viewers.add(session);

    console.log(`[SignalingServer] Viewer joined device ${deviceId} (CanControl: ${session.canControl})`);

    // Notify viewer of current status & permission capabilities
    session.ws.send(JSON.stringify({
      type: 'connection-established',
      deviceId,
      canControl: session.canControl,
      canView: session.canView,
      agentOnline: !!room.agent,
    }));

    if (room.agent && room.agent.ws.readyState === WebSocket.OPEN) {
      // Request agent to start or refresh stream for this device
      room.agent.ws.send(JSON.stringify({ type: 'start-stream', deviceId }));
      DeviceService.updateStatus(deviceId, 'streaming');
    }

    session.ws.on('message', (data: string) => {
      try {
        const msg = JSON.parse(data.toString());

        switch (msg.type) {
          case 'control-input': {
            // CRITICAL SECURITY CHECK: Enforce canControl authorization before executing input!
            if (!session.canControl) {
              session.ws.send(JSON.stringify({
                type: 'error',
                message: 'Unauthorized: You only have view permission for this device.'
              }));
              return;
            }

            // Forward verified input event to agent (which translates it to scrcpy control protocol)
            if (room.agent && room.agent.ws.readyState === WebSocket.OPEN) {
              room.agent.ws.send(JSON.stringify({
                type: 'control-input',
                deviceId,
                action: msg.action, // 'touch_down', 'touch_up', 'touch_move', 'key_event', 'text', 'back', 'home', 'recents', 'rotate'
                data: msg.data,
              }));
            }
            break;
          }

          case 'webrtc-offer':
          case 'webrtc-answer':
          case 'ice-candidate': {
            // Forward viewer signaling to the agent
            if (room.agent && room.agent.ws.readyState === WebSocket.OPEN) {
              room.agent.ws.send(JSON.stringify(msg));
            }
            break;
          }

          case 'request-keyframe': {
            if (room.agent && room.agent.ws.readyState === WebSocket.OPEN) {
              room.agent.ws.send(JSON.stringify({ type: 'request-keyframe', deviceId }));
            }
            break;
          }
        }
      } catch (err) {
        console.error('[SignalingServer] Error handling viewer message:', err);
      }
    });

    session.ws.on('close', () => {
      console.log(`[SignalingServer] Viewer left device ${deviceId}`);
      room.viewers.delete(session);
      if (room.viewers.size === 0 && room.agent && room.agent.ws.readyState === WebSocket.OPEN) {
        // If no more viewers, notify agent to idle stream
        room.agent.ws.send(JSON.stringify({ type: 'idle-stream', deviceId }));
        DeviceService.updateStatus(deviceId, 'online');
      }
    });
  }
}
