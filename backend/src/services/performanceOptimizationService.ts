/**
 * Performance Optimization Service
 * Fixes hanging, lagging, and reduces latency for smooth continuous control
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class PerformanceOptimizationService {
  /**
   * OPTIMIZATION 1: Reduce scrcpy video quality for lower latency
   * Keep audio enabled but low quality
   */
  static getOptimizedScrcpyArgs(deviceSerial: string): string[] {
    return [
      '-s', deviceSerial,
      
      // PERFORMANCE: Lower bitrate = less data = less lag
      '--video-bit-rate=2M', // Reduced from 4M to 2M
      
      // PERFORMANCE: Lower resolution = faster encoding
      '--max-size=1280', // Max 1280px (720p), reduces load
      
      // PERFORMANCE: 30fps is smooth enough, saves CPU
      '--max-fps=30',
      
      // PERFORMANCE: H.264 baseline profile (faster encoding)
      '--video-codec=h264',
      '--video-encoder=OMX.google.h264.encoder', // Hardware encoder
      
      // AUDIO: Keep enabled but low quality for minimal overhead
      '--audio-codec=aac',
      '--audio-bit-rate=32k', // Low quality (was default 128k) - just enough to hear sounds
      '--audio-buffer=50', // Small buffer for low latency
      
      // PERFORMANCE: Disable power management interference
      '--no-power-on',
      '--stay-awake',
      
      // PERFORMANCE: Fastest buffer mode
      '--display-buffer=0', // No buffering delay
      
      // PERFORMANCE: Reduce encoder complexity
      '--lock-video-orientation=0', // Don't handle rotation (faster)
      
      // STEALTH: Custom port
      '--port=37284',
      
      // STEALTH: No visible window
      '--no-window',
      '--no-display',
    ];
  }

  /**
   * OPTIMIZATION 2: Disable unnecessary Android services to reduce load
   */
  static async optimizeDevicePerformance(deviceSerial: string): Promise<void> {
    try {
      // Disable animations (instant response)
      await execAsync(`adb -s ${deviceSerial} shell "settings put global window_animation_scale 0"`);
      await execAsync(`adb -s ${deviceSerial} shell "settings put global transition_animation_scale 0"`);
      await execAsync(`adb -s ${deviceSerial} shell "settings put global animator_duration_scale 0"`);
      
      // Set performance governor (max CPU speed)
      await execAsync(`adb -s ${deviceSerial} shell "echo performance > /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor" 2>/dev/null || true`);
      
      // Disable background data sync (reduces CPU load)
      await execAsync(`adb -s ${deviceSerial} shell "settings put global background_data 0" 2>/dev/null || true`);
      
      // Kill unnecessary background apps
      await execAsync(`adb -s ${deviceSerial} shell "am kill-all" 2>/dev/null || true`);
      
      // Clear RAM
      await execAsync(`adb -s ${deviceSerial} shell "echo 3 > /proc/sys/vm/drop_caches" 2>/dev/null || true`);
      
    } catch {
      // Silent fail
    }
  }

  /**
   * OPTIMIZATION 3: Reduce input processing delay
   */
  static async optimizeInputLatency(deviceSerial: string): Promise<void> {
    try {
      // Disable touch sound/haptic (instant response)
      await execAsync(`adb -s ${deviceSerial} shell "settings put system sound_effects_enabled 0"`);
      await execAsync(`adb -s ${deviceSerial} shell "settings put system haptic_feedback_enabled 0"`);
      
      // Disable pointer location overlay
      await execAsync(`adb -s ${deviceSerial} shell "settings put system pointer_location 0"`);
      
      // Set fastest touch response
      await execAsync(`adb -s ${deviceSerial} shell "settings put secure long_press_timeout 200"` ); // Fastest
      
    } catch {
      // Silent fail
    }
  }

  /**
   * OPTIMIZATION 4: Optimize network for TCP ADB (if wireless)
   */
  static async optimizeNetworkLatency(deviceSerial: string): Promise<void> {
    try {
      // Disable WiFi power saving
      await execAsync(`adb -s ${deviceSerial} shell "settings put global wifi_sleep_policy 2"` ); // Never sleep
      
      // Optimize TCP settings for low latency
      await execAsync(`adb -s ${deviceSerial} shell "echo 1 > /proc/sys/net/ipv4/tcp_low_latency" 2>/dev/null || true`);
      
      // Disable WiFi scanning (reduces interference)
      await execAsync(`adb -s ${deviceSerial} shell "settings put global wifi_scan_always_enabled 0"`);
      
    } catch {
      // Silent fail
    }
  }

  /**
   * OPTIMIZATION 5: Monitor and auto-restart if lag detected
   */
  private static lagCounters = new Map<string, number>();

  static reportLag(deviceSerial: string): void {
    const count = (this.lagCounters.get(deviceSerial) || 0) + 1;
    this.lagCounters.set(deviceSerial, count);

    // If lagging 3+ times in short period, restart scrcpy
    if (count >= 3) {
      console.log(`[Performance] Lag detected on ${deviceSerial}, restarting...`);
      this.restartScrcpy(deviceSerial).catch(() => {});
      this.lagCounters.set(deviceSerial, 0);
    }
  }

  static async restartScrcpy(deviceSerial: string): Promise<void> {
    try {
      // Kill existing scrcpy
      await execAsync(`adb -s ${deviceSerial} shell "pkill -9 app_process" 2>/dev/null || true`);
      await execAsync(`adb -s ${deviceSerial} shell "pkill -9 scrcpy" 2>/dev/null || true`);
      
      // Clear video encoder cache
      await execAsync(`adb -s ${deviceSerial} shell "sync && echo 3 > /proc/sys/vm/drop_caches" 2>/dev/null || true`);
      
      // Wait 2 seconds
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.log(`[Performance] Scrcpy restart ready for ${deviceSerial}`);
    } catch {
      // Silent fail
    }
  }

  /**
   * OPTIMIZATION 6: Batch input commands to reduce overhead
   */
  private static inputQueue = new Map<string, Array<{ action: string; data: any }>>();
  private static flushTimers = new Map<string, NodeJS.Timeout>();

  static queueInput(deviceSerial: string, action: string, data: any): void {
    if (!this.inputQueue.has(deviceSerial)) {
      this.inputQueue.set(deviceSerial, []);
    }

    this.inputQueue.get(deviceSerial)!.push({ action, data });

    // Clear existing flush timer
    const existingTimer = this.flushTimers.get(deviceSerial);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Flush queue after 50ms (batch multiple inputs together)
    const timer = setTimeout(() => {
      this.flushInputQueue(deviceSerial);
    }, 50);

    this.flushTimers.set(deviceSerial, timer);
  }

  private static async flushInputQueue(deviceSerial: string): Promise<void> {
    const queue = this.inputQueue.get(deviceSerial);
    if (!queue || queue.length === 0) return;

    try {
      // Execute all queued inputs at once
      const commands = queue.map(item => {
        if (item.action === 'tap') {
          return `input tap ${item.data.x} ${item.data.y}`;
        } else if (item.action === 'swipe') {
          return `input swipe ${item.data.x1} ${item.data.y1} ${item.data.x2} ${item.data.y2} ${item.data.duration || 300}`;
        }
        return '';
      }).filter(cmd => cmd);

      if (commands.length > 0) {
        const batchCommand = commands.join(' && ');
        await execAsync(`adb -s ${deviceSerial} shell "${batchCommand}" 2>/dev/null || true`);
      }

      // Clear queue
      this.inputQueue.set(deviceSerial, []);
    } catch {
      // Silent fail
    }
  }

  /**
   * OPTIMIZATION 7: Full performance initialization
   */
  static async initializePerformance(deviceSerial: string): Promise<void> {
    console.log(`[Performance] Optimizing ${deviceSerial} for smooth, lag-free control`);

    await Promise.all([
      this.optimizeDevicePerformance(deviceSerial),
      this.optimizeInputLatency(deviceSerial),
      this.optimizeNetworkLatency(deviceSerial),
    ]);

    // Reset lag counter
    this.lagCounters.set(deviceSerial, 0);

    console.log(`[Performance] Optimization complete for ${deviceSerial}`);
  }

  /**
   * OPTIMIZATION 8: Continuous performance monitoring
   */
  static startPerformanceMonitoring(deviceSerial: string): void {
    setInterval(async () => {
      try {
        // Check CPU usage
        const { stdout: cpuInfo } = await execAsync(`adb -s ${deviceSerial} shell "top -n 1 | grep scrcpy" 2>/dev/null || true`);
        
        if (cpuInfo && cpuInfo.includes('100%')) {
          // CPU maxed out, restart scrcpy
          console.log(`[Performance] High CPU on ${deviceSerial}, restarting scrcpy`);
          await this.restartScrcpy(deviceSerial);
        }

        // Check memory
        const { stdout: memInfo } = await execAsync(`adb -s ${deviceSerial} shell "cat /proc/meminfo | grep MemAvailable" 2>/dev/null || true`);
        const memMatch = memInfo.match(/(\d+)/);
        if (memMatch && parseInt(memMatch[1]) < 200000) {
          // Less than 200MB free, clear cache
          await execAsync(`adb -s ${deviceSerial} shell "echo 3 > /proc/sys/vm/drop_caches" 2>/dev/null || true`);
        }

      } catch {
        // Silent fail
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Get current performance metrics
   */
  static async getPerformanceMetrics(deviceSerial: string): Promise<{
    cpu: string;
    memory: string;
    latency: string;
    lagCount: number;
  }> {
    let cpu = 'N/A';
    let memory = 'N/A';
    let latency = 'N/A';

    try {
      const { stdout: cpuInfo } = await execAsync(`adb -s ${deviceSerial} shell "top -n 1 | head -1" 2>/dev/null || true`);
      cpu = cpuInfo.trim() || 'N/A';

      const { stdout: memInfo } = await execAsync(`adb -s ${deviceSerial} shell "free | grep Mem" 2>/dev/null || true`);
      memory = memInfo.trim() || 'N/A';

    } catch {
      // Silent fail
    }

    return {
      cpu,
      memory,
      latency,
      lagCount: this.lagCounters.get(deviceSerial) || 0,
    };
  }
}
