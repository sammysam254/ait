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
  private deviceRooms: Map<string, { agent?: ClientSession; viewers: Set<ClientSession>; lastHeader?: Buffer }> = new Map();
  private connectedAgents: Set<ClientSession> = new Set();

  constructor(server: HttpServer) {
    this.wss = new WebSocketServer({
      server,
      path: '/ws',
      perMessageDeflate: false, // Critical: disables CPU-heavy zlib compression on pre-compressed H.264 streams
      maxPayload: 100 * 1024 * 1024,
      clientTracking: true,
    });
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
        let decoded: any;
        try {
          decoded = jwt.verify(token, config.jwtSecret) as any;
        } catch (e) {
          // Fallback to decode Supabase access tokens
          decoded = jwt.decode(token) as any;
        }

        if (!decoded) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid token structure.' }));
          ws.close(4001, 'Unauthorized');
          return;
        }

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
          const userId = decoded.id || decoded.sub;
          const userEmail = (decoded.email || '').toLowerCase().trim();
          const isSuperAdmin = userEmail === 'sammyseth260@gmail.com';

          let profile = inMemoryDb.profiles.get(userId);
          if (!profile) {
            profile = {
              id: userId,
              email: userEmail,
              full_name: isSuperAdmin ? 'Sammy Seth (Super Admin)' : (decoded.user_metadata?.full_name || userEmail.split('@')[0]),
              system_role: isSuperAdmin ? 'admin' : (decoded.user_metadata?.system_role || 'customer'),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            inMemoryDb.profiles.set(userId, profile);
          }

          if (!requestedDeviceId) {
            ws.send(JSON.stringify({ type: 'error', message: 'deviceId parameter required for device stream.' }));
            ws.close(4002, 'Missing deviceId');
            return;
          }

          let organizationId = decoded.organizationId;
          if (!organizationId) {
            organizationId = isSuperAdmin ? 'aaaa0000-0000-0000-0000-000000000001' : ('org_' + userId);
          }

          // Check permissions via DeviceService
          const access = DeviceService.getDeviceById(requestedDeviceId, {
            id: profile.id,
            email: profile.email,
            system_role: profile.system_role,
            organizationId,
          });

          if (access.status !== 200 || !access.device) {
            ws.send(JSON.stringify({ type: 'error', message: access.error || 'Device not found.' }));
            ws.close(4003, 'Forbidden');
            return;
          }

          const targetDeviceId = access.device.id;

          session = {
            ws,
            type: 'viewer',
            role: profile.system_role,
            userId: profile.id,
            organizationId,
            deviceId: targetDeviceId,
            canControl: profile.system_role === 'admin' || (access.permissions?.can_control ?? true),
            canView: true,
          };

          this.handleViewerConnection(session, targetDeviceId);
          if (requestedDeviceId !== targetDeviceId) {
            this.getRoom(requestedDeviceId).viewers.add(session);
          }
        }
      } catch (err: any) {
        console.error('[SignalingServer] Auth error:', err?.message || err);
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid or expired token.' }));
        ws.close(4001, 'Unauthorized');
      }
    });

    console.log('[SignalingServer] WebSocket Signaling and Streaming gateway initialized on /ws');

    // Server-side heartbeat to keep Cloudflare, ALB, and Nginx reverse proxy tunnels permanently active
    setInterval(() => {
      for (const agent of this.connectedAgents) {
        if (agent.ws.readyState === WebSocket.OPEN) {
          try { agent.ws.ping(); } catch (e) {}
        }
      }
      for (const room of this.deviceRooms.values()) {
        for (const viewer of room.viewers) {
          if (viewer.ws.readyState === WebSocket.OPEN) {
            try { viewer.ws.ping(); } catch (e) {}
          }
        }
      }
    }, 10000);
  }

  private getRoom(deviceId: string) {
    if (!this.deviceRooms.has(deviceId)) {
      this.deviceRooms.set(deviceId, { viewers: new Set() });
    }
    return this.deviceRooms.get(deviceId)!;
  }

  private handleAgentConnection(session: ClientSession) {
    this.connectedAgents.add(session);
    console.log(`[SignalingServer] Agent connected: ${session.agentId} (Org: ${session.organizationId})`);

    session.ws.on('message', (data: Buffer | string) => {
      try {
        // Can be text signaling message or binary video frame
        if (typeof data !== 'string' && !(data instanceof String)) {
          // Binary message: Video frame stream from scrcpy streaming bridge
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
          let targetDeviceId: string | null = null;
          let videoPayload = buf;

          // Fast zero-regex UUID extraction (hyphens at offsets 8, 13, 18, 23)
          if (buf.length > 36 && buf[8] === 0x2d && buf[13] === 0x2d && buf[18] === 0x2d && buf[23] === 0x2d) {
            targetDeviceId = buf.subarray(0, 36).toString('ascii');
            videoPayload = buf.subarray(36);
          }

          // Detect SPS / PPS keyframe config headers
          const isConfig = (videoPayload.length >= 5 &&
            ((videoPayload[0] === 0x00 && videoPayload[1] === 0x00 && videoPayload[2] === 0x00 && videoPayload[3] === 0x01 && (videoPayload[4] & 0x1f) === 7) ||
             (videoPayload[0] === 0x00 && videoPayload[1] === 0x00 && videoPayload[2] === 0x01 && (videoPayload[3] & 0x1f) === 7)));

          // Find serial associated with targetDeviceId
          const dev = targetDeviceId ? inMemoryDb.devices.get(targetDeviceId) : null;
          const serial = dev ? dev.adb_serial : '';

          let forwarded = 0;
          const targetRoom = targetDeviceId ? this.deviceRooms.get(targetDeviceId) : null;
          if (targetRoom && targetRoom.viewers.size > 0) {
            // Producer exclusivity: only forward frames from the room's designated active agent!
            if (targetRoom.agent && targetRoom.agent !== session) {
              return; // Drop duplicate frames from superseded or rogue secondary agent session
            }
            targetRoom.agent = session;
            if (isConfig) {
              targetRoom.lastHeader = videoPayload;
            }
            for (const viewer of targetRoom.viewers) {
              if (viewer.ws.readyState === WebSocket.OPEN) {
                // Strict 128KB buffer ceiling: guarantees viewer never accumulates more than ~100ms latency
                const isAudio = videoPayload.length > 4 && videoPayload[0] === 0x41 && videoPayload[1] === 0x55 && videoPayload[2] === 0x44 && videoPayload[3] === 0x3a;
                if (isAudio && viewer.ws.bufferedAmount > 64 * 1024) continue;
                if (!isConfig && !isAudio && viewer.ws.bufferedAmount > 128 * 1024) continue;
                viewer.ws.send(videoPayload);
                forwarded++;
              }
            }
          } else {
            // Forward once to active room matching the device serial (never duplicate)
            for (const [rDevId, r] of this.deviceRooms.entries()) {
              if (r.viewers.size === 0) continue;
              const rDev = inMemoryDb.devices.get(rDevId);
              const matches = (rDevId === targetDeviceId) || (serial && rDev && rDev.adb_serial === serial);
              if (matches) {
                if (r.agent && r.agent !== session) {
                  return; // Drop duplicate frames from superseded or rogue secondary agent session
                }
                r.agent = session;
                if (isConfig) {
                  r.lastHeader = videoPayload;
                }
                for (const viewer of r.viewers) {
                  if (viewer.ws.readyState === WebSocket.OPEN) {
                    const isAudio = videoPayload.length > 4 && videoPayload[0] === 0x41 && videoPayload[1] === 0x55 && videoPayload[2] === 0x44 && videoPayload[3] === 0x3a;
                    if (isAudio && viewer.ws.bufferedAmount > 64 * 1024) continue;
                    if (!isConfig && !isAudio && viewer.ws.bufferedAmount > 128 * 1024) continue;
                    viewer.ws.send(videoPayload);
                    forwarded++;
                  }
                }
                break; // Exactly one room delivered; prevents multiplication loops!
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
            if (room.agent && room.agent !== session && room.agent.ws.readyState === WebSocket.OPEN) {
              console.log(`[SignalingServer] Superseding older agent connection for device ${deviceId}`);
              try { room.agent.ws.close(4009, 'Superseded by newer agent session'); } catch (e) {}
            }
            room.agent = session;
            DeviceService.updateStatus(deviceId, 'online');
            session.ws.send(JSON.stringify({ type: 'registered', deviceId, success: true }));
            console.log(`[SignalingServer] Agent registered producer for device ${deviceId} (serial: ${msg.serial || 'unknown'})`);

            // If viewers are already in the room, immediately initiate the stream and broadcast fresh keyframe
            if (room.viewers.size > 0) {
              const dev = inMemoryDb.devices.get(deviceId);
              const serial = dev ? dev.adb_serial : (msg.serial || '');
              session.ws.send(JSON.stringify({ type: 'start-stream', deviceId, serial }));
              DeviceService.updateStatus(deviceId, 'streaming');
              for (const viewer of room.viewers) {
                if (viewer.ws.readyState === WebSocket.OPEN) {
                  if (room.lastHeader) {
                    try { viewer.ws.send(room.lastHeader); } catch (e) {}
                  }
                  viewer.ws.send(JSON.stringify({
                    type: 'connection-established',
                    deviceId,
                    agentOnline: true,
                    canControl: viewer.canControl,
                  }));
                }
              }
            }
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

          case 'device-dimensions': {
            const { deviceId, width, height } = msg;
            const targetDevId = deviceId || session.deviceId;
            if (targetDevId && width && height) {
              const dev = inMemoryDb.devices.get(targetDevId);
              if (dev) {
                dev.screen_width = width;
                dev.screen_height = height;
                dev.updated_at = new Date().toISOString();
              }
              const room = this.getRoom(targetDevId);
              for (const viewer of room.viewers) {
                if (viewer.ws.readyState === WebSocket.OPEN) {
                  viewer.ws.send(JSON.stringify({
                    type: 'device-dimensions',
                    deviceId: targetDevId,
                    width,
                    height,
                  }));
                }
              }
            }
            break;
          }

          case 'ping': {
            if (session.ws.readyState === WebSocket.OPEN) {
              session.ws.send(JSON.stringify({ type: 'pong' }));
            }
            break;
          }
        }
      } catch (err) {
        console.error('[SignalingServer] Error handling agent message:', err);
      }
    });

    session.ws.on('close', () => {
      this.connectedAgents.delete(session);
      console.log(`[SignalingServer] Agent disconnected: ${session.agentId}`);
      if (session.deviceId) {
        const devId = session.deviceId;
        const room = this.getRoom(devId);
        if (room.agent === session) {
          room.agent = undefined;
          // Grace period: allow 5s for agent reconnection before declaring device offline
          setTimeout(() => {
            const currentRoom = this.deviceRooms.get(devId);
            if (currentRoom && (!currentRoom.agent || currentRoom.agent.ws.readyState !== WebSocket.OPEN)) {
              DeviceService.updateStatus(devId, 'offline');
              for (const viewer of currentRoom.viewers) {
                if (viewer.ws.readyState === WebSocket.OPEN) {
                  viewer.ws.send(JSON.stringify({ type: 'device-offline', deviceId: devId }));
                }
              }
            }
          }, 5000);
        }
      }
    });
  }

  private handleViewerConnection(session: ClientSession, deviceId: string) {
    const room = this.getRoom(deviceId);
    room.viewers.add(session);

    const dev = inMemoryDb.devices.get(deviceId);
    const serial = dev ? dev.adb_serial : '';

    // If room has no active agent assigned, bind the first available connected agent
    if (!room.agent || room.agent.ws.readyState !== WebSocket.OPEN) {
      for (const ag of this.connectedAgents) {
        if (ag.ws.readyState === WebSocket.OPEN) {
          room.agent = ag;
          break;
        }
      }
    }

    console.log(`[SignalingServer] Viewer joined device ${deviceId} (Serial: ${serial}, AgentOnline: ${!!room.agent}, CanControl: ${session.canControl})`);

    // Notify viewer of current status & permission capabilities
    session.ws.send(JSON.stringify({
      type: 'connection-established',
      deviceId,
      canControl: session.canControl,
      canView: session.canView,
      agentOnline: !!room.agent,
    }));

    if (dev && dev.screen_width && dev.screen_height) {
      session.ws.send(JSON.stringify({
        type: 'device-dimensions',
        deviceId,
        width: dev.screen_width,
        height: dev.screen_height,
      }));
    }

    // If we have cached SPS/PPS header, send it immediately so the player starts with zero delay
    if (room.lastHeader && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(room.lastHeader);
    }

    // Always request stream from available agent
    const activeAgent = (room.agent && room.agent.ws.readyState === WebSocket.OPEN) ? room.agent : Array.from(this.connectedAgents).find(a => a.ws.readyState === WebSocket.OPEN);
    if (activeAgent) {
      room.agent = activeAgent;
      activeAgent.ws.send(JSON.stringify({ type: 'start-stream', deviceId, serial }));
      DeviceService.updateStatus(deviceId, 'streaming');
    }

    session.ws.on('message', (data: string) => {
      try {
        const msg = JSON.parse(data.toString());
        const agentSession = (room.agent && room.agent.ws.readyState === WebSocket.OPEN) ? room.agent : Array.from(this.connectedAgents).find(a => a.ws.readyState === WebSocket.OPEN);

        switch (msg.type) {
          case 'ping': {
            if (session.ws.readyState === WebSocket.OPEN) {
              session.ws.send(JSON.stringify({ type: 'pong' }));
            }
            break;
          }

          case 'request-stream': {
            if (agentSession) {
              room.agent = agentSession;
              agentSession.ws.send(JSON.stringify({ type: 'start-stream', deviceId, serial }));
              DeviceService.updateStatus(deviceId, 'streaming');
            }
            break;
          }

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
            if (agentSession) {
              room.agent = agentSession;
              agentSession.ws.send(JSON.stringify({
                type: 'control-input',
                deviceId: msg.deviceId || deviceId,
                serial: serial || (dev ? dev.adb_serial : ''),
                action: msg.action,
                data: msg.data,
              }));
            }
            break;
          }

          case 'webrtc-offer':
          case 'webrtc-answer':
          case 'ice-candidate': {
            // Forward viewer signaling to the agent
            if (agentSession) {
              agentSession.ws.send(JSON.stringify(msg));
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
