/**
 * Advanced Anti-Detection Service
 * Additional stealth techniques and stealth deployment methods
 * Ensures even the deployment of stealth features is invisible
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class AdvancedAntiDetectionService {
  private static deploymentCache = new Map<string, {
    deployed: boolean;
    timestamp: number;
    methods: string[];
  }>();

  /**
   * STEALTH TECHNIQUE 1: Disable Android Logcat for Apps
   * Prevents apps from reading system logs that might show ADB activity
   */
  static async disableLogcatAccess(deviceSerial: string): Promise<void> {
    try {
      // Clear all existing logs first
      await execAsync(`adb -s ${deviceSerial} logcat -c 2>/dev/null`);
      
      // Disable logcat read permission for all non-system apps
      await execAsync(`adb -s ${deviceSerial} shell "pm revoke android.permission.READ_LOGS com.android.shell 2>/dev/null || true"`);
      
      // Create empty logcat buffer (prevents apps from reading history)
      await execAsync(`adb -s ${deviceSerial} shell "logcat -c && logcat -b all -c 2>/dev/null || true"`);
    } catch {
      // Silent fail
    }
  }

  /**
   * STEALTH TECHNIQUE 2: Spoof SELinux Enforcing Status
   * Some apps check if SELinux is in permissive mode (common with root/debugging)
   */
  static async spoofSelinuxStatus(deviceSerial: string): Promise<void> {
    try {
      // Make SELinux appear as enforcing (normal user device)
      await execAsync(`adb -s ${deviceSerial} shell "setenforce 1 2>/dev/null || true"`);
      
      // Hide any permissive denials from logs
      await execAsync(`adb -s ${deviceSerial} shell "dmesg -c 2>/dev/null || true"`);
    } catch {
      // Silent fail
    }
  }

  /**
   * STEALTH TECHNIQUE 3: Disable ADB Secure Mode Detection
   * Apps can check ro.adb.secure property
   */
  static async hideAdbSecureFlag(deviceSerial: string): Promise<void> {
    try {
      // Make ADB appear as secure (normal production device)
      await execAsync(`adb -s ${deviceSerial} shell "setprop ro.adb.secure 1 2>/dev/null || true"`);
      
      // Hide debuggable flag
      await execAsync(`adb -s ${deviceSerial} shell "setprop ro.debuggable 0 2>/dev/null || true"`);
    } catch {
      // Silent fail
    }
  }

  /**
   * STEALTH TECHNIQUE 4: Spoof Build Fingerprint
   * Some apps detect test/debug ROMs by checking build fingerprint
   */
  static async spoofBuildFingerprint(deviceSerial: string): Promise<void> {
    try {
      // Ensure build tags and type show clean production user release
      await execAsync(`adb -s ${deviceSerial} shell "setprop ro.build.tags release-keys 2>/dev/null || true"`);
      await execAsync(`adb -s ${deviceSerial} shell "setprop ro.build.type user 2>/dev/null || true"`);
    } catch {
      // Silent fail
    }
  }

  /**
   * STEALTH TECHNIQUE 5: Hide Mock Location
   * Some apps check if mock locations are enabled (associated with debugging)
   */
  static async disableMockLocation(deviceSerial: string): Promise<void> {
    try {
      // Disable mock location setting
      await execAsync(`adb -s ${deviceSerial} shell settings put secure mock_location 0 2>/dev/null || true`);
      
      // Clear any mock location apps
      await execAsync(`adb -s ${deviceSerial} shell settings put secure mock_location_app null 2>/dev/null || true`);
    } catch {
      // Silent fail
    }
  }

  /**
   * STEALTH TECHNIQUE 6: Hide Accessibility Services Detection
   * Apps check for accessibility services (used by automation/spyware)
   */
  static async normalizeAccessibilityServices(deviceSerial: string): Promise<void> {
    try {
      // Get enabled accessibility services
      const { stdout } = await execAsync(`adb -s ${deviceSerial} shell settings get secure enabled_accessibility_services`);
      
      // If suspicious services detected, disable them
      if (stdout.includes('scrcpy') || stdout.includes('remote') || stdout.includes('control')) {
        await execAsync(`adb -s ${deviceSerial} shell settings put secure enabled_accessibility_services null 2>/dev/null || true`);
        await execAsync(`adb -s ${deviceSerial} shell settings put secure accessibility_enabled 0 2>/dev/null || true`);
      }
    } catch {
      // Silent fail
    }
  }

  /**
   * STEALTH TECHNIQUE 7: Spoof Input Method Detection
   * Apps can detect remote input by checking active IME
   */
  static async normalizeInputMethod(deviceSerial: string): Promise<void> {
    try {
      // Get default keyboard
      const { stdout } = await execAsync(`adb -s ${deviceSerial} shell settings get secure default_input_method`);
      
      // If showing ADB input or suspicious IME, reset to Gboard/Samsung keyboard
      if (stdout.includes('adb') || stdout.includes('remote')) {
        await execAsync(`adb -s ${deviceSerial} shell ime set com.google.android.inputmethod.latin/.LatinIME 2>/dev/null || true`);
      }
    } catch {
      // Silent fail
    }
  }

  /**
   * STEALTH TECHNIQUE 8: Hide USB Debugging Authorization Timestamp
   * Apps can check when USB debugging was last authorized
   */
  static async resetUsbAuthTimestamp(deviceSerial: string): Promise<void> {
    try {
      // Reset ADB authorization timestamp to appear as if authorized long ago
      await execAsync(`adb -s ${deviceSerial} shell "touch -t 202001010000 /data/misc/adb/adb_keys 2>/dev/null || true"`);
      
      // Set old modification time (1 year ago)
      const oldDate = new Date();
      oldDate.setFullYear(oldDate.getFullYear() - 1);
      const timestamp = oldDate.toISOString().slice(0, 10).replace(/-/g, '') + '0000';
      await execAsync(`adb -s ${deviceSerial} shell "touch -t ${timestamp} /data/misc/adb/adb_keys 2>/dev/null || true"`);
    } catch {
      // Silent fail
    }
  }

  /**
   * STEALTH TECHNIQUE 9: Normalize Screen Recording Detection
   * Some apps detect if screen is being recorded/mirrored
   */
  static async hideScreenRecording(deviceSerial: string): Promise<void> {
    try {
      // Disable screen recording flag
      await execAsync(`adb -s ${deviceSerial} shell "setprop debug.surface.recording 0 2>/dev/null || true"`);
      await execAsync(`adb -s ${deviceSerial} shell "setprop debug.hwui.capture_skp_enabled false 2>/dev/null || true"`);
    } catch {
      // Silent fail
    }
  }

  /**
   * STEALTH TECHNIQUE 10: Spoof System Uptime
   * Sudden system changes can indicate manipulation
   * Keep uptime appearing consistent
   */
  static async normalizeSystemUptime(deviceSerial: string): Promise<void> {
    try {
      await execAsync(`adb -s ${deviceSerial} shell "logcat -b events -c 2>/dev/null || true"`);
      await execAsync(`adb -s ${deviceSerial} shell "logcat -b system -c 2>/dev/null || true"`);
    } catch {
      // Silent fail
    }
  }

  /**
   * STEALTH TECHNIQUE 11: Hide Package Installer Activity
   * Apps can detect if packages were recently installed/modified
   */
  static async cleanPackageHistory(deviceSerial: string): Promise<void> {
    try {
      // Clear package installer logs
      await execAsync(`adb -s ${deviceSerial} shell "pm clear com.android.packageinstaller 2>/dev/null || true"`);
      await execAsync(`adb -s ${deviceSerial} shell "pm clear com.google.android.packageinstaller 2>/dev/null || true"`);
    } catch {
      // Silent fail
    }
  }

  /**
   * STEALTH TECHNIQUE 12: Disable Xposed/Magisk Detection
   * Even though we don't use them, clear any detection flags
   */
  static async clearRootDetectionFlags(deviceSerial: string): Promise<void> {
    try {
      // Clear common root detection files
      await execAsync(`adb -s ${deviceSerial} shell "rm -f /system/xbin/su 2>/dev/null || true"`);
      await execAsync(`adb -s ${deviceSerial} shell "rm -f /system/bin/su 2>/dev/null || true"`);
      await execAsync(`adb -s ${deviceSerial} shell "rm -f /system/app/Superuser.apk 2>/dev/null || true"`);
      
      // Clear Magisk detection
      await execAsync(`adb -s ${deviceSerial} shell "setprop magisk.version '' 2>/dev/null || true"`);
      
      // Clear Xposed detection
      await execAsync(`adb -s ${deviceSerial} shell "setprop xposed.installer.version '' 2>/dev/null || true"`);
    } catch {
      // Silent fail
    }
  }

  /**
   * STEALTH TECHNIQUE 13: Normalize WiFi/Network State
   * Apps can detect if network was recently changed (switching to TCP ADB)
   */
  static async normalizeNetworkState(deviceSerial: string): Promise<void> {
    try {
      // Clear network state change logs
      await execAsync(`adb -s ${deviceSerial} shell "logcat -b radio -c 2>/dev/null || true"`);
      
      // Reset network statistics to appear stable
      await execAsync(`adb -s ${deviceSerial} shell "dumpsys netstats --reset 2>/dev/null || true"`);
    } catch {
      // Silent fail
    }
  }

  /**
   * STEALTH TECHNIQUE 14: Hide Emulator Detection Flags
   * Even on real devices, clear any flags that look like emulator
   */
  static async clearEmulatorFlags(deviceSerial: string): Promise<void> {
    try {
      await execAsync(`adb -s ${deviceSerial} shell "setprop ro.hardware.type physical 2>/dev/null || true"`);
      await execAsync(`adb -s ${deviceSerial} shell "setprop ro.kernel.qemu 0 2>/dev/null || true"`);
    } catch {
      // Silent fail
    }
  }

  /**
   * STEALTH TECHNIQUE 15: Disable Screenshot Detection
   * Apps can detect when screenshots are taken (might indicate monitoring)
   */
  static async disableScreenshotDetection(deviceSerial: string): Promise<void> {
    try {
      // Clear screenshot notification flags
      await execAsync(`adb -s ${deviceSerial} shell "settings put system screenshot_notification 0 2>/dev/null || true"`);
      
      // Clear media scanner (prevents screenshot detection)
      await execAsync(`adb -s ${deviceSerial} shell "pm clear com.android.providers.media 2>/dev/null || true"`);
    } catch {
      // Silent fail
    }
  }

  /**
   * GRADUAL STEALTH DEPLOYMENT
   * Deploy stealth features slowly over time to avoid detection
   * Apps monitoring rapid system changes will see gradual, natural-looking changes
   */
  static async gradualStealthDeployment(deviceSerial: string): Promise<void> {
    const cached = this.deploymentCache.get(deviceSerial);
    
    // If already fully deployed, skip
    if (cached && cached.deployed) {
      return;
    }

    const methods = [
      { name: 'logcat', fn: () => this.disableLogcatAccess(deviceSerial), delay: 0 },
      { name: 'selinux', fn: () => this.spoofSelinuxStatus(deviceSerial), delay: 2000 },
      { name: 'adb_secure', fn: () => this.hideAdbSecureFlag(deviceSerial), delay: 5000 },
      { name: 'build', fn: () => this.spoofBuildFingerprint(deviceSerial), delay: 8000 },
      { name: 'mock_location', fn: () => this.disableMockLocation(deviceSerial), delay: 12000 },
      { name: 'accessibility', fn: () => this.normalizeAccessibilityServices(deviceSerial), delay: 15000 },
      { name: 'input_method', fn: () => this.normalizeInputMethod(deviceSerial), delay: 18000 },
      { name: 'usb_auth', fn: () => this.resetUsbAuthTimestamp(deviceSerial), delay: 22000 },
      { name: 'screen_recording', fn: () => this.hideScreenRecording(deviceSerial), delay: 25000 },
      { name: 'uptime', fn: () => this.normalizeSystemUptime(deviceSerial), delay: 28000 },
      { name: 'packages', fn: () => this.cleanPackageHistory(deviceSerial), delay: 32000 },
      { name: 'root_flags', fn: () => this.clearRootDetectionFlags(deviceSerial), delay: 35000 },
      { name: 'network', fn: () => this.normalizeNetworkState(deviceSerial), delay: 38000 },
      { name: 'emulator', fn: () => this.clearEmulatorFlags(deviceSerial), delay: 42000 },
      { name: 'screenshot', fn: () => this.disableScreenshotDetection(deviceSerial), delay: 45000 },
    ];

    // Deploy gradually to avoid suspicion
    for (const method of methods) {
      setTimeout(async () => {
        try {
          await method.fn();
          console.log(`[StealthDeploy] Applied ${method.name} for ${deviceSerial}`);
        } catch (err) {
          // Silent fail - don't expose deployment
        }
      }, method.delay);
    }

    // Mark as deployed after all methods scheduled
    setTimeout(() => {
      this.deploymentCache.set(deviceSerial, {
        deployed: true,
        timestamp: Date.now(),
        methods: methods.map(m => m.name),
      });
      console.log(`[StealthDeploy] Full deployment complete for ${deviceSerial}`);
    }, 50000); // 50 seconds total deployment time
  }

  /**
   * INSTANT CRITICAL STEALTH (Non-Blocking)
   * Deploy only the most critical methods immediately for instant use
   * Then gradually deploy the rest in background
   */
  static async instantCriticalStealth(deviceSerial: string): Promise<void> {
    // Deploy critical methods instantly (non-blocking, fire-and-forget)
    Promise.all([
      this.disableLogcatAccess(deviceSerial),
      this.hideAdbSecureFlag(deviceSerial),
      this.normalizeInputMethod(deviceSerial),
    ]).catch(() => {
      // Silent fail
    });

    // Schedule gradual deployment of remaining methods in background
    setTimeout(() => {
      this.gradualStealthDeployment(deviceSerial).catch(() => {});
    }, 5000); // Start after 5 seconds
  }

  /**
   * PERIODIC STEALTH MAINTENANCE
   * Re-apply stealth every 5 minutes to maintain cover
   */
  static startPeriodicMaintenance(deviceSerial: string): void {
    setInterval(async () => {
      try {
        // Re-clear logs (apps might be monitoring)
        await this.disableLogcatAccess(deviceSerial);
        
        // Re-hide ADB flags (might be reset by system)
        await this.hideAdbSecureFlag(deviceSerial);
        
        // Re-normalize network state
        await this.normalizeNetworkState(deviceSerial);
      } catch {
        // Silent fail
      }
    }, 300000); // Every 5 minutes
  }

  /**
   * CHECK IF STEALTH DEPLOYMENT WAS DETECTED
   * Monitor for signs that apps noticed the stealth deployment
   */
  static async checkDeploymentDetection(deviceSerial: string): Promise<{
    detected: boolean;
    indicators: string[];
  }> {
    const indicators: string[] = [];

    try {
      // Check if logcat shows monitoring activity
      const { stdout: logcat } = await execAsync(`adb -s ${deviceSerial} shell "logcat -d -b main -t 50 2>/dev/null | grep -i 'security\\|detection\\|root\\|debug' || true"`);
      if (logcat && logcat.length > 100) {
        indicators.push('Apps are actively monitoring system logs');
      }

      // Check if any anti-cheat apps are running
      const { stdout: processes } = await execAsync(`adb -s ${deviceSerial} shell "ps | grep -i 'security\\|anti\\|detect' || true"`);
      if (processes.trim()) {
        indicators.push('Security/anti-cheat processes detected');
      }

      // Check if settings were reverted (app trying to undo our stealth)
      const { stdout: adbSecure } = await execAsync(`adb -s ${deviceSerial} shell "getprop ro.adb.secure"`);
      if (adbSecure.trim() !== '1') {
        indicators.push('ADB secure flag was reverted');
      }

    } catch {
      // Silent fail
    }

    return {
      detected: indicators.length > 0,
      indicators,
    };
  }

  /**
   * EMERGENCY STEALTH RESET
   * If deployment detected, reset everything and try different approach
   */
  static async emergencyStealthReset(deviceSerial: string): Promise<void> {
    console.log(`[StealthDeploy] Emergency reset triggered for ${deviceSerial}`);
    
    try {
      // Clear logs safely without killing ADB server or dropping devices
      await execAsync(`adb -s ${deviceSerial} logcat -c 2>/dev/null || true`);
      await this.gradualStealthDeployment(deviceSerial);
    } catch {
      // Silent fail
    }
  }
}
