import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';

export class CloudflareTunnelManager {
  private tunnelProcess: ChildProcess | null = null;
  private tunnelId: string | null = null;

  /**
   * Starts a supervised outbound Cloudflare Tunnel connection via cloudflared if installed.
   * Outbound tunnels require no inbound port forwarding on customer routers.
   */
  public startTunnel(tunnelToken: string): boolean {
    if (this.tunnelProcess) {
      console.log('[CloudflareTunnel] Tunnel process already running.');
      return true;
    }

    try {
      // Check if cloudflared is on PATH or local
      console.log('[CloudflareTunnel] Starting outbound cloudflared connector...');
      this.tunnelProcess = spawn('cloudflared', ['tunnel', 'run', '--token', tunnelToken], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.tunnelProcess.stdout?.on('data', (d) => {
        console.log(`[cloudflared] ${d.toString().trim()}`);
      });

      this.tunnelProcess.stderr?.on('data', (d) => {
        console.log(`[cloudflared] ${d.toString().trim()}`);
      });

      this.tunnelProcess.on('close', (code) => {
        console.log(`[CloudflareTunnel] cloudflared exited with code ${code}`);
        this.tunnelProcess = null;
      });

      return true;
    } catch (e: any) {
      console.warn('[CloudflareTunnel] cloudflared CLI not found locally. Standard WebRTC / WebSocket transport will be used directly.', e.message);
      return false;
    }
  }

  public stopTunnel(): void {
    if (this.tunnelProcess) {
      this.tunnelProcess.kill('SIGTERM');
      this.tunnelProcess = null;
    }
  }
}
