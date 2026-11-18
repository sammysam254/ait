import WebSocket from 'ws';
import { AdbManager } from '../adb/adbManager';
import { ScrcpyManager } from '../scrcpy/scrcpyManager';

export interface StreamBridgeOptions {
  backendWsUrl: string;
  agentAuthToken: string;
  adbManager: AdbManager;
  scrcpyManager: ScrcpyManager;
}

export class StreamBridge {
  private ws: WebSocket | null = null;
  private options: StreamBridgeOptions;
  private activeStreams: Map<string, { interval: NodeJS.Timeout; serial: string }> = new Map();
  private deviceSerials: Map<string, string> = new Map();
  private isReconnecting = false;

  constructor(options: StreamBridgeOptions) {
    this.options = options;
  }

  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const wsUrl = `${this.options.backendWsUrl}/ws?token=${encodeURIComponent(this.options.agentAuthToken)}&type=agent`;
    console.log(`[StreamBridge] Connecting to cloud signaling server: ${this.options.backendWsUrl}/ws...`);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        console.log('[StreamBridge] Connected to cloud signaling server successfully.');
        this.isReconnecting = false;
        // Re-register all known device producers with cloud server
        for (const [devId, ser] of this.deviceSerials.entries()) {
          this.registerDeviceProducer(devId, ser);
        }
      });

      this.ws.on('message', async (data: string) => {
        try {
          const msg = JSON.parse(data.toString());
          await this.handleMessage(msg);
        } catch (e) {
          console.error('[StreamBridge] Failed to parse incoming message:', e);
        }
      });

      this.ws.on('close', (code, reason) => {
        console.warn(`[StreamBridge] Disconnected from cloud signaling server (${code}: ${reason}). Auto-reconnecting in 3s...`);
        this.stopAllStreams();
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        console.warn('[StreamBridge] WebSocket connection error:', err.message);
      });
    } catch (err: any) {
      console.error('[StreamBridge] Connection attempt failed:', err.message);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.isReconnecting) return;
    this.isReconnecting = true;
    setTimeout(() => {
      this.connect();
    }, 3000);
  }

  public registerDeviceProducer(deviceId: string, serial?: string): void {
    if (serial) {
      this.deviceSerials.set(deviceId, serial);
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'agent-register-device',
        deviceId,
      }));
    }
  }

  private async handleMessage(msg: any): Promise<void> {
    switch (msg.type) {
      case 'start-stream': {
        const { deviceId, serial } = msg;
        console.log(`[StreamBridge] Received start-stream request for device: ${deviceId}`);
        this.startDeviceStream(deviceId, serial || '');
        break;
      }

      case 'idle-stream': {
        const { deviceId } = msg;
        console.log(`[StreamBridge] Received idle-stream request for device: ${deviceId}`);
        this.stopDeviceStream(deviceId);
        break;
      }

      case 'control-input': {
        const { deviceId, action, data } = msg;
        const stream = this.activeStreams.get(deviceId);
        const targetSerial = stream ? stream.serial : (msg.serial || this.deviceSerials.get(deviceId) || '');
        if (targetSerial) {
          await this.options.adbManager.injectInput(targetSerial, action, data);
        }
        break;
      }

      case 'webrtc-offer':
      case 'webrtc-answer':
      case 'ice-candidate': {
        // Forward WebRTC signals
        console.log(`[StreamBridge] Received signaling: ${msg.type}`);
        break;
      }
    }
  }

  public startDeviceStream(deviceId: string, serial?: string): void {
    const targetSerial = serial || this.deviceSerials.get(deviceId) || '';
    if (!targetSerial) {
      console.warn(`[StreamBridge] Cannot start stream: no serial known for device ${deviceId}`);
      return;
    }

    if (this.activeStreams.has(deviceId)) return;

    console.log(`[StreamBridge] Starting active stream for device ${deviceId} (${targetSerial})`);

    let inFlight = false;
    const interval = setInterval(async () => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (inFlight) return;

      inFlight = true;
      try {
        const buffer = await this.options.adbManager.captureScreenshot(targetSerial);
        if (buffer && buffer.length > 0 && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(buffer);
        }
      } catch (err) {
        // Ignore single frame capture error
      } finally {
        inFlight = false;
      }
    }, 65); // ~15 FPS smooth low-latency browser mirroring

    this.activeStreams.set(deviceId, { interval, serial: targetSerial });
    this.registerDeviceProducer(deviceId, targetSerial);
  }

  public stopDeviceStream(deviceId: string): void {
    const stream = this.activeStreams.get(deviceId);
    if (stream) {
      clearInterval(stream.interval);
      this.activeStreams.delete(deviceId);
    }
  }

  public stopAllStreams(): void {
    for (const deviceId of this.activeStreams.keys()) {
      this.stopDeviceStream(deviceId);
    }
  }
}
