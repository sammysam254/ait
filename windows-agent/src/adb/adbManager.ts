import { execFile, execSync } from 'child_process';
import fs from 'fs';

export interface DiscoveredDevice {
  adbSerial: string;
  deviceName: string;
  model: string;
  manufacturer: string;
  androidVersion: string;
  sdkVersion: number;
  screenWidth: number;
  screenHeight: number;
  screenDensity: number;
  connectionType: 'usb' | 'wifi';
  status: 'online' | 'offline' | 'unauthorized';
}

export class AdbManager {
  private adbPath: string;

  constructor(adbPath: string) {
    this.adbPath = adbPath;
  }

  public isAdbAvailable(): boolean {
    if (fs.existsSync(this.adbPath)) return true;
    try {
      execSync(`"${this.adbPath}" version`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  private runAdb(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(this.adbPath, args, { timeout: 15000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
        } else {
          resolve(stdout.toString());
        }
      });
    });
  }

  /**
   * Scans for all connected Android devices (USB and Wi-Fi)
   */
  public async getConnectedDevices(): Promise<DiscoveredDevice[]> {
    if (!this.isAdbAvailable()) {
      return [];
    }

    try {
      const output = await this.runAdb(['devices', '-l']);
      const lines = output.split('\n');
      const devices: DiscoveredDevice[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('List of devices')) continue;

        // Example: 'R5CN80ABC1D    device product:dm3q model:SM_S918B device:dm3q transport_id:1'
        // Example: 'ZY3223GTR5     unauthorized ...'
        const parts = trimmed.split(/\s+/);
        if (parts.length < 2) continue;

        const serial = parts[0];
        const state = parts[1]; // 'device', 'offline', 'unauthorized'

        if (state === 'unauthorized') {
          devices.push({
            adbSerial: serial,
            deviceName: `Android (${serial.slice(0, 8)})`,
            model: 'Unauthorized',
            manufacturer: 'Unknown',
            androidVersion: 'Unknown',
            sdkVersion: 0,
            screenWidth: 1080,
            screenHeight: 2400,
            screenDensity: 420,
            connectionType: serial.includes(':') ? 'wifi' : 'usb',
            status: 'unauthorized',
          });
          continue;
        }

        if (state !== 'device') {
          continue;
        }

        // Fetch detailed properties
        let model = 'Android Phone';
        let manufacturer = 'Generic';
        let androidVersion = '14';
        let sdkVersion = 34;
        let screenWidth = 1080;
        let screenHeight = 2400;
        let screenDensity = 420;

        try {
          const props = await this.runAdb(['-s', serial, 'shell', 'getprop']);
          const modelMatch = props.match(/\[ro\.product\.model\]:\s*\[(.*?)\]/);
          if (modelMatch) model = modelMatch[1];

          const mfgMatch = props.match(/\[ro\.product\.manufacturer\]:\s*\[(.*?)\]/);
          if (mfgMatch) manufacturer = mfgMatch[1];

          const verMatch = props.match(/\[ro\.build\.version\.release\]:\s*\[(.*?)\]/);
          if (verMatch) androidVersion = verMatch[1];

          const sdkMatch = props.match(/\[ro\.build\.version\.sdk\]:\s*\[(.*?)\]/);
          if (sdkMatch) sdkVersion = parseInt(sdkMatch[1], 10) || 34;

          // Screen resolution
          const sizeOutput = await this.runAdb(['-s', serial, 'shell', 'wm', 'size']);
          const sizeMatch = sizeOutput.match(/Physical size:\s*(\d+)x(\d+)/) || sizeOutput.match(/size:\s*(\d+)x(\d+)/);
          if (sizeMatch) {
            screenWidth = parseInt(sizeMatch[1], 10);
            screenHeight = parseInt(sizeMatch[2], 10);
          }

          // Screen density
          const densityOutput = await this.runAdb(['-s', serial, 'shell', 'wm', 'density']);
          const densityMatch = densityOutput.match(/Physical density:\s*(\d+)/) || densityOutput.match(/density:\s*(\d+)/);
          if (densityMatch) {
            screenDensity = parseInt(densityMatch[1], 10);
          }
        } catch (propErr) {
          // If shell command fails, fallback to line parsing
          for (const p of parts) {
            if (p.startsWith('model:')) model = p.replace('model:', '').replace(/_/g, ' ');
          }
        }

        devices.push({
          adbSerial: serial,
          deviceName: `${manufacturer} ${model}`.trim(),
          model,
          manufacturer,
          androidVersion,
          sdkVersion,
          screenWidth,
          screenHeight,
          screenDensity,
          connectionType: serial.includes(':') ? 'wifi' : 'usb',
          status: 'online',
        });
      }

      return devices;
    } catch (err) {
      console.warn('[AdbManager] Failed to query devices:', err);
      return [];
    }
  }

  /**
   * Executes remote input injection (tap, swipe, keyevent, text)
   */
  public async injectInput(serial: string, action: string, data: any): Promise<boolean> {
    try {
      switch (action) {
        case 'tap': {
          const { x, y } = data;
          await this.runAdb(['-s', serial, 'shell', 'input', 'tap', Math.round(x).toString(), Math.round(y).toString()]);
          return true;
        }

        case 'swipe': {
          const { startX, startY, endX, endY, durationMs } = data;
          const duration = durationMs || 250;
          await this.runAdb([
            '-s', serial, 'shell', 'input', 'swipe',
            Math.round(startX).toString(),
            Math.round(startY).toString(),
            Math.round(endX).toString(),
            Math.round(endY).toString(),
            duration.toString(),
          ]);
          return true;
        }

        case 'key_event': {
          const { keyCode } = data;
          await this.runAdb(['-s', serial, 'shell', 'input', 'keyevent', keyCode.toString()]);
          return true;
        }

        case 'back': {
          await this.runAdb(['-s', serial, 'shell', 'input', 'keyevent', '4']); // KEYCODE_BACK
          return true;
        }

        case 'home': {
          await this.runAdb(['-s', serial, 'shell', 'input', 'keyevent', '3']); // KEYCODE_HOME
          return true;
        }

        case 'recents': {
          await this.runAdb(['-s', serial, 'shell', 'input', 'keyevent', '187']); // KEYCODE_APP_SWITCH
          return true;
        }

        case 'text': {
          const { text } = data;
          const escaped = (text || '').replace(/([^\w])/g, '\\$1');
          await this.runAdb(['-s', serial, 'shell', 'input', 'text', escaped]);
          return true;
        }

        case 'rotate': {
          // Toggle rotation: 0 (portrait) or 1 (landscape)
          const target = data?.orientation === 'landscape' ? '1' : '0';
          await this.runAdb(['-s', serial, 'shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0']);
          await this.runAdb(['-s', serial, 'shell', 'settings', 'put', 'system', 'user_rotation', target]);
          await this.runAdb(['-s', serial, 'shell', 'wm', 'user-rotation', 'lock', target]);
          return true;
        }

        default:
          return false;
      }
    } catch (e) {
      console.error(`[AdbManager] Failed to inject input ${action}:`, e);
      return false;
    }
  }

  /**
   * Captures screen snapshot as JPEG/PNG buffer for low-latency visual preview
   */
  public captureScreenshot(serial: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      execFile(this.adbPath, ['-s', serial, 'exec-out', 'screencap', '-p'], { encoding: 'buffer', maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
        if (err) {
          reject(err);
        } else {
          resolve(stdout);
        }
      });
    });
  }
}
