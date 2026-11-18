import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { inMemoryDb, DeviceShare } from '../database/supabaseClient';
import { config } from '../config';

export class SharingService {
  /**
   * Generates a 6-digit random numeric PIN
   */
  private static generateRandomPin(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Generates a secure URL share token
   */
  private static generateShareToken(): string {
    return 'vtx_sh_' + crypto.randomBytes(18).toString('base64url');
  }

  /**
   * Create or replace a device share link
   */
  static async createShare(
    deviceId: string,
    organizationId: string,
    userId: string,
    options: {
      allowControl?: boolean;
      expirationHours?: number;
      maxUses?: number;
      customPin?: string;
    } = {}
  ): Promise<{ share: DeviceShare; plainPin: string }> {
    const plainPin = options.customPin && /^\d{4,8}$/.test(options.customPin) 
      ? options.customPin 
      : this.generateRandomPin();

    const pinHash = await bcrypt.hash(plainPin, 10);
    const shareToken = this.generateShareToken();
    const expiresAt = new Date(Date.now() + (options.expirationHours || 24) * 3600 * 1000).toISOString();

    const newShare: DeviceShare = {
      id: uuidv4(),
      organization_id: organizationId,
      device_id: deviceId,
      share_token: shareToken,
      pin_hash: pinHash,
      pin_preview: plainPin, // stored for owner preview in UI
      allow_control: options.allowControl ?? false,
      expires_at: expiresAt,
      max_uses: options.maxUses ?? 50,
      current_uses: 0,
      failed_attempts: 0,
      is_revoked: false,
      created_by: userId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    inMemoryDb.deviceShares.set(newShare.id, newShare);

    // Audit log
    inMemoryDb.auditLogs.unshift({
      id: uuidv4(),
      organization_id: organizationId,
      user_id: userId,
      action: 'DEVICE_SHARE_CREATED',
      resource_type: 'device_share',
      resource_id: newShare.id,
      details: { deviceId, allowControl: newShare.allow_control, expiresAt },
      created_at: new Date().toISOString(),
    });

    return { share: newShare, plainPin };
  }

  /**
   * Get active share for a device (owner only)
   */
  static getShareForDevice(deviceId: string, organizationId: string): DeviceShare | undefined {
    return Array.from(inMemoryDb.deviceShares.values()).find(
      s => s.device_id === deviceId && s.organization_id === organizationId && !s.is_revoked
    );
  }

  /**
   * Rotate PIN: Invalidates previous PIN and assigns a new one
   */
  static async rotatePin(shareId: string, organizationId: string, userId: string): Promise<{ share: DeviceShare; newPin: string } | null> {
    const share = inMemoryDb.deviceShares.get(shareId);
    if (!share || share.organization_id !== organizationId) return null;

    const newPin = this.generateRandomPin();
    share.pin_hash = await bcrypt.hash(newPin, 10);
    share.pin_preview = newPin;
    share.failed_attempts = 0;
    share.locked_until = undefined;
    share.updated_at = new Date().toISOString();

    // Audit log
    inMemoryDb.auditLogs.unshift({
      id: uuidv4(),
      organization_id: organizationId,
      user_id: userId,
      action: 'DEVICE_SHARE_PIN_ROTATED',
      resource_type: 'device_share',
      resource_id: share.id,
      details: { deviceId: share.device_id },
      created_at: new Date().toISOString(),
    });

    return { share, newPin };
  }

  /**
   * Rotate Share Token URL: Invalidates old URL immediately
   */
  static rotateToken(shareId: string, organizationId: string, userId: string): DeviceShare | null {
    const share = inMemoryDb.deviceShares.get(shareId);
    if (!share || share.organization_id !== organizationId) return null;

    share.share_token = this.generateShareToken();
    share.current_uses = 0;
    share.failed_attempts = 0;
    share.locked_until = undefined;
    share.updated_at = new Date().toISOString();

    // Audit log
    inMemoryDb.auditLogs.unshift({
      id: uuidv4(),
      organization_id: organizationId,
      user_id: userId,
      action: 'DEVICE_SHARE_URL_ROTATED',
      resource_type: 'device_share',
      resource_id: share.id,
      details: { deviceId: share.device_id },
      created_at: new Date().toISOString(),
    });

    return share;
  }

  /**
   * Revoke Share: Instantly terminates sharing
   */
  static revokeShare(shareId: string, organizationId: string, userId: string): boolean {
    const share = inMemoryDb.deviceShares.get(shareId);
    if (!share || share.organization_id !== organizationId) return false;

    share.is_revoked = true;
    share.updated_at = new Date().toISOString();

    // Audit log
    inMemoryDb.auditLogs.unshift({
      id: uuidv4(),
      organization_id: organizationId,
      user_id: userId,
      action: 'DEVICE_SHARE_REVOKED',
      resource_type: 'device_share',
      resource_id: share.id,
      details: { deviceId: share.device_id },
      created_at: new Date().toISOString(),
    });

    return true;
  }

  /**
   * Inspect Share by public token (without verifying PIN yet)
   */
  static inspectShareToken(token: string): { valid: boolean; deviceName?: string; expiresAt?: string; allowControl?: boolean; error?: string } {
    const share = Array.from(inMemoryDb.deviceShares.values()).find(s => s.share_token === token);

    if (!share || share.is_revoked) {
      return {
        valid: false,
        error: 'ACCESS UNAVAILABLE\n\nThis device access link is no longer active.\nThe owner may have revoked or renewed this sharing session.\nPlease request a new access link from the device owner.'
      };
    }

    if (new Date(share.expires_at).getTime() < Date.now()) {
      return {
        valid: false,
        error: 'ACCESS EXPIRED\n\nThis device sharing session has expired.\nPlease request a new link from the device owner.'
      };
    }

    if (share.current_uses >= share.max_uses) {
      return {
        valid: false,
        error: 'ACCESS LIMIT REACHED\n\nThis sharing link has reached its maximum allowed sessions.'
      };
    }

    const device = inMemoryDb.devices.get(share.device_id);

    return {
      valid: true,
      deviceName: device ? device.device_name : 'Android Device',
      expiresAt: share.expires_at,
      allowControl: share.allow_control,
    };
  }

  /**
   * Authenticate Share with PIN & generate session viewer token
   */
  static async verifyPinAndAuthorize(
    token: string,
    candidatePin: string,
    clientIp = 'unknown'
  ): Promise<{ success: boolean; sessionToken?: string; deviceId?: string; allowControl?: boolean; error?: string }> {
    const share = Array.from(inMemoryDb.deviceShares.values()).find(s => s.share_token === token);

    // Standardized generic response to prevent token enumeration
    if (!share || share.is_revoked) {
      return {
        success: false,
        error: 'ACCESS UNAVAILABLE: This device access link is invalid or has been revoked.'
      };
    }

    // Check temporary brute-force lockout
    if (share.locked_until && new Date(share.locked_until).getTime() > Date.now()) {
      const waitMinutes = Math.ceil((new Date(share.locked_until).getTime() - Date.now()) / 60000);
      return {
        success: false,
        error: `Too many failed PIN attempts. Device access is locked for ${waitMinutes} more minute(s).`
      };
    }

    // Expiration check
    if (new Date(share.expires_at).getTime() < Date.now()) {
      return {
        success: false,
        error: 'ACCESS EXPIRED: This sharing session has expired.'
      };
    }

    // PIN check
    const isMatch = await bcrypt.compare(candidatePin, share.pin_hash);
    if (!isMatch) {
      share.failed_attempts += 1;
      
      // Lock out after 5 consecutive failed attempts for 15 minutes
      if (share.failed_attempts >= 5) {
        share.locked_until = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      }

      return {
        success: false,
        error: `Incorrect access PIN. Remaining attempts: ${Math.max(0, 5 - share.failed_attempts)}`
      };
    }

    // Reset failed attempts on success
    share.failed_attempts = 0;
    share.locked_until = undefined;
    share.current_uses += 1;

    // Issue short-lived viewer session JWT (expires in 4 hours)
    const sessionToken = jwt.sign(
      {
        shareId: share.id,
        deviceId: share.device_id,
        organizationId: share.organization_id,
        allowControl: share.allow_control,
        type: 'share_session',
      },
      config.jwtSecret,
      { expiresIn: '4h' }
    );

    // Audit log
    inMemoryDb.auditLogs.unshift({
      id: uuidv4(),
      organization_id: share.organization_id,
      action: 'DEVICE_SHARE_VIEWER_AUTHENTICATED',
      resource_type: 'device_share',
      resource_id: share.id,
      details: { clientIp, deviceId: share.device_id },
      created_at: new Date().toISOString(),
    });

    return {
      success: true,
      sessionToken,
      deviceId: share.device_id,
      allowControl: share.allow_control,
    };
  }
}
