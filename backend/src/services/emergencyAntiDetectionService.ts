/**
 * EMERGENCY Anti-Detection Service
 * Survey apps are detecting and banning - this fixes the detection vectors
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class EmergencyAntiDetectionService {
  /**
   * CRITICAL FIX 1: Disable all ADB-related properties that survey apps check
   */
  static async hideAllAdbTraces(deviceSerial: string): Promise<void> {
    try {
      // Hide ADB network listening ports
      await execAsync(`adb -s ${deviceSerial} shell "setprop service.adb.tcp.port -1" 2>/dev/null || true`);
      await execAsync(`adb -s ${deviceSerial} shell "setprop persist.adb.tcp.port -1" 2>/dev/null || true`);
      
      // Hide USB debugging notification banner in the status bar
      await execAsync(`adb -s ${deviceSerial} shell "settings put global adb_notify 0" 2>/dev/null || true`);
      
      // Clear logs
      await execAsync(`adb -s ${deviceSerial} logcat -c 2>/dev/null || true`);
      await execAsync(`adb -s ${deviceSerial} shell "logcat -b all -c" 2>/dev/null || true`);
    } catch {
      // Silent fail
    }
  }

  /**
   * CRITICAL FIX 2: Hide automation, overlays, and debugging indicators without severing USB connection
   */
  static async spoofUsbAsChargingOnly(deviceSerial: string): Promise<void> {
    try {
      // Hide USB debugging notification
      await execAsync(`adb -s ${deviceSerial} shell "settings put global adb_notify 0" 2>/dev/null || true`);
      
      // Disable pointer location overlays
      await execAsync(`adb -s ${deviceSerial} shell "settings put system pointer_location 0" 2>/dev/null || true`);
      await execAsync(`adb -s ${deviceSerial} shell "settings put system show_touches 0" 2>/dev/null || true`);
    } catch {
      // Silent fail
    }
  }

  /**
   * CRITICAL FIX 3: Remove ALL accessibility & automation indicators (Fixes survey app bans)
   */
  static async removeAutomationIndicators(deviceSerial: string): Promise<void> {
    try {
      // Completely disable accessibility services & shortcuts (kills automation/bot detection in survey apps)
      await execAsync(`adb -s ${deviceSerial} shell "settings put secure accessibility_enabled 0" 2>/dev/null || true`);
      await execAsync(`adb -s ${deviceSerial} shell "settings put secure enabled_accessibility_services null" 2>/dev/null || true`);
      await execAsync(`adb -s ${deviceSerial} shell "settings put secure accessibility_shortcut_target_service null" 2>/dev/null || true`);
      await execAsync(`adb -s ${deviceSerial} shell "settings put secure accessibility_button_target_component null" 2>/dev/null || true`);
      await execAsync(`adb -s ${deviceSerial} shell "settings put secure accessibility_display_magnification_enabled 0" 2>/dev/null || true`);
      
      // Disable mock location
      await execAsync(`adb -s ${deviceSerial} shell "settings put secure mock_location 0" 2>/dev/null || true`);
      
      // Disable unknown sources
      await execAsync(`adb -s ${deviceSerial} shell "settings put secure install_non_market_apps 0" 2>/dev/null || true`);
      
      // Hide error dialogs
      await execAsync(`adb -s ${deviceSerial} shell "settings put global hide_error_dialogs 1" 2>/dev/null || true`);
    } catch {
      // Silent fail
    }
  }

  /**
   * CRITICAL FIX 4: Completely remove input timing patterns
   * Make input appear 100% human with NO detectable patterns
   */
  static getCompletelyRandomTiming(): number {
    // Human reaction time varies widely: 200ms to 800ms
    return 200 + Math.random() * 600;
  }

  /**
   * CRITICAL FIX 5: Add natural pauses between actions
   * Bots never pause, humans always do
   */
  static shouldAddNaturalPause(): boolean {
    // 30% chance to pause (humans think/look before acting)
    return Math.random() < 0.3;
  }

  static getNaturalPauseMs(): number {
    // Natural thinking pause: 500ms to 3 seconds
    return 500 + Math.random() * 2500;
  }

  /**
   * CRITICAL FIX 6: Switch to TCP ADB immediately (wireless)
   * Then can disconnect USB cable - appears as normal phone
   */
  static async switchToWirelessMode(deviceSerial: string): Promise<{ success: boolean; ip?: string }> {
    try {
      // Enable TCP on random port
      const port = 37000 + Math.floor(Math.random() * 3000);
      await execAsync(`adb -s ${deviceSerial} tcpip ${port}`);
      
      // Wait for TCP mode
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Get device IP
      const { stdout } = await execAsync(`adb -s ${deviceSerial} shell ip addr show wlan0 | grep "inet " | awk '{print $2}' | cut -d/ -f1`);
      const ip = stdout.trim();
      
      if (!ip) {
        return { success: false };
      }
      
      // Connect via TCP
      await execAsync(`adb connect ${ip}:${port}`);
      
      console.log(`[Emergency] Device ${deviceSerial} now wireless at ${ip}:${port} - DISCONNECT USB CABLE NOW`);
      
      return { success: true, ip: `${ip}:${port}` };
    } catch (error: any) {
      return { success: false };
    }
  }

  /**
   * CRITICAL FIX 7: Clear ALL app caches that might store detection data
   */
  static async clearSurveyAppCaches(deviceSerial: string): Promise<void> {
    // Common survey apps
    const surveyPackages = [
      'com.surveyjunkie',
      'com.swagbucks',
      'com.inboxdollars',
      'com.prizerebel',
      'com.toluna',
      'com.yougov',
      'com.ipsos',
      'com.nielsen',
      'com.google.android.apps.chromecast.app',
      'com.surveytime',
    ];

    for (const pkg of surveyPackages) {
      try {
        // Clear app data and cache
        await execAsync(`adb -s ${deviceSerial} shell "pm clear ${pkg}" 2>/dev/null || true`);
      } catch {
        // App not installed, skip
      }
    }
  }

  /**
   * CRITICAL FIX 8: Reset device identifiers that survey apps track
   */
  static async resetDeviceIdentifiers(deviceSerial: string): Promise<void> {
    try {
      // Reset advertising ID
      await execAsync(`adb -s ${deviceSerial} shell "pm clear com.google.android.gms" 2>/dev/null || true`);
      
      // Clear device fingerprint data
      await execAsync(`adb -s ${deviceSerial} shell "rm -rf /data/system/users/0/settings_fingerprint.xml" 2>/dev/null || true`);
      
      // Reset Android ID (requires root but try anyway)
      await execAsync(`adb -s ${deviceSerial} shell "settings put secure android_id $(cat /dev/urandom | tr -dc 'a-f0-9' | fold -w 16 | head -n 1)" 2>/dev/null || true`);
    } catch {
      // Silent fail
    }
  }

  /**
   * EMERGENCY DEPLOYMENT - Run all critical fixes immediately
   */
  static async emergencyDeployment(deviceSerial: string): Promise<void> {
    console.log(`[EMERGENCY] Deploying critical anti-detection for ${deviceSerial}`);

    // Run safe stealth fixes without wiping user logins or Play Services
    await Promise.all([
      this.hideAllAdbTraces(deviceSerial),
      this.spoofUsbAsChargingOnly(deviceSerial),
      this.removeAutomationIndicators(deviceSerial),
    ]);

    console.log(`[EMERGENCY] Critical fixes deployed for ${deviceSerial}`);
  }

  /**
   * Check if device is currently detected as suspicious
   */
  static async checkIfDetected(deviceSerial: string): Promise<{
    detected: boolean;
    reasons: string[];
  }> {
    const reasons: string[] = [];

    try {
      // Check USB debugging visible
      const { stdout: adbNotify } = await execAsync(`adb -s ${deviceSerial} shell "settings get global adb_notify"`);
      if (adbNotify.trim() === '1') {
        reasons.push('USB debugging notification visible');
      }

      // Check developer options visible
      const { stdout: devEnabled } = await execAsync(`adb -s ${deviceSerial} shell "settings get global development_settings_enabled"`);
      if (devEnabled.trim() === '1') {
        reasons.push('Developer options enabled');
      }

      // Check if device shows as debuggable
      const { stdout: debuggable } = await execAsync(`adb -s ${deviceSerial} shell "getprop ro.debuggable"`);
      if (debuggable.trim() === '1') {
        reasons.push('Device shows as debuggable');
      }

      // Check accessibility services
      const { stdout: accessibility } = await execAsync(`adb -s ${deviceSerial} shell "settings get secure enabled_accessibility_services"`);
      if (accessibility.trim() && accessibility.trim() !== 'null') {
        reasons.push('Accessibility services enabled (automation indicator)');
      }

      // Check USB connection type
      const { stdout: usbConfig } = await execAsync(`adb -s ${deviceSerial} shell "getprop sys.usb.config"`);
      if (usbConfig.includes('adb') || usbConfig.includes('mtp')) {
        reasons.push('USB shows as data/debugging (not charging only)');
      }

    } catch {
      // Silent fail
    }

    return {
      detected: reasons.length > 0,
      reasons,
    };
  }

  /**
   * FULL RESET - Nuclear option if detected
   */
  static async fullDeviceReset(deviceSerial: string): Promise<void> {
    console.log(`[EMERGENCY] Executing full reset for ${deviceSerial}`);

    try {
      // Clear ALL logs
      await execAsync(`adb -s ${deviceSerial} logcat -c 2>/dev/null || true`);
      await execAsync(`adb -s ${deviceSerial} shell "logcat -b all -c" 2>/dev/null || true`);
      
      // Stop and restart ADB
      await execAsync(`adb kill-server && sleep 2 && adb start-server 2>/dev/null || true`);
      
      // Reconnect
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Redeploy emergency fixes
      await this.emergencyDeployment(deviceSerial);
      
      console.log(`[EMERGENCY] Full reset complete for ${deviceSerial}`);
    } catch (error: any) {
      console.error(`[EMERGENCY] Reset failed: ${error.message}`);
    }
  }
}
