import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface ScrcpyOptions {
  serial: string;
  bitrate?: number;
  maxFps?: number;
  maxSize?: number;
  stayAwake?: boolean;
  turnScreenOff?: boolean;
}

export class ScrcpyManager {
  private scrcpyPath: string;
  private scrcpyServerPath: string;
  private activeProcesses: Map<string, ChildProcess> = new Map();

  constructor(scrcpyPath: string, scrcpyServerPath: string) {
    this.scrcpyPath = scrcpyPath;
    this.scrcpyServerPath = scrcpyServerPath;
  }

  public isScrcpyAvailable(): boolean {
    return fs.existsSync(this.scrcpyPath);
  }

  /**
   * Starts a supervised scrcpy session for a target device
   */
  public startSession(options: ScrcpyOptions, onData?: (chunk: Buffer) => void): boolean {
    if (!this.isScrcpyAvailable()) {
      console.warn('[ScrcpyManager] scrcpy binary not found at:', this.scrcpyPath);
      return false;
    }

    if (this.activeProcesses.has(options.serial)) {
      console.log(`[ScrcpyManager] Session already running for ${options.serial}`);
      return true;
    }

    // Supported official scrcpy 3.3.4 arguments
    const args: string[] = [
      '--serial', options.serial,
      '--video-codec=h264',
      '--max-fps', (options.maxFps || 30).toString(),
      '--video-bit-rate', (options.bitrate || 4000000).toString(),
    ];

    if (options.maxSize) {
      args.push('--max-size', options.maxSize.toString());
    }

    if (options.stayAwake) {
      args.push('--stay-awake');
    }

    if (options.turnScreenOff) {
      args.push('--turn-screen-off');
    }

    console.log(`[ScrcpyManager] Launching scrcpy for ${options.serial}: ${args.join(' ')}`);

    try {
      const proc = spawn(this.scrcpyPath, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.activeProcesses.set(options.serial, proc);

      proc.stdout?.on('data', (data: Buffer) => {
        if (onData) onData(data);
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        // Log meaningful warnings
        if (text.includes('ERROR') || text.includes('WARN')) {
          console.warn(`[scrcpy ${options.serial}] ${text.trim()}`);
        }
      });

      proc.on('close', (code) => {
        console.log(`[ScrcpyManager] Process for ${options.serial} exited with code ${code}`);
        this.activeProcesses.delete(options.serial);
      });

      return true;
    } catch (err) {
      console.error(`[ScrcpyManager] Failed to launch scrcpy for ${options.serial}:`, err);
      return false;
    }
  }

  /**
   * Gracefully terminates an active scrcpy session
   */
  public stopSession(serial: string): void {
    const proc = this.activeProcesses.get(serial);
    if (proc) {
      try {
        proc.kill('SIGTERM');
      } catch (e) {
        proc.kill('SIGKILL');
      }
      this.activeProcesses.delete(serial);
      console.log(`[ScrcpyManager] Stopped scrcpy session for ${serial}`);
    }
  }

  /**
   * Stop all active sessions on shutdown
   */
  public stopAll(): void {
    for (const serial of this.activeProcesses.keys()) {
      this.stopSession(serial);
    }
  }
}
