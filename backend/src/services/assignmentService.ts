import { v4 as uuidv4 } from 'uuid';
import { inMemoryDb, AssignedUser, DeviceAssignment, Profile } from '../database/supabaseClient';
import { SharingService } from './sharingService';

export class AssignmentService {
  /**
   * List subordinate assigned users for the organization
   */
  static listAssignedUsers(organizationId: string): Array<AssignedUser & { assignedDevicesCount: number }> {
    return Array.from(inMemoryDb.assignedUsers.values())
      .filter(au => au.organization_id === organizationId)
      .map(au => {
        const count = Array.from(inMemoryDb.deviceAssignments.values())
          .filter(da => da.assigned_user_id === au.user_id).length;
        return {
          ...au,
          assignedDevicesCount: count,
        };
      });
  }

  /**
   * Create or invite a subordinate user under the customer's organization
   */
  static inviteSubordinateUser(
    organizationId: string,
    invitedByUserId: string,
    email: string,
    fullName?: string
  ): { success: boolean; user?: AssignedUser; error?: string } {
    // Check if user profile already exists
    let profile = Array.from(inMemoryDb.profiles.values()).find(p => p.email.toLowerCase() === email.toLowerCase());

    if (!profile) {
      // Create profile with assigned_user role
      const userId = uuidv4();
      profile = {
        id: userId,
        email: email.toLowerCase(),
        full_name: fullName || email.split('@')[0],
        system_role: 'assigned_user',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      inMemoryDb.profiles.set(userId, profile);
    } else if (profile.system_role === 'customer' || profile.system_role === 'admin') {
      return { success: false, error: 'A primary customer or admin account already exists with this email.' };
    }

    // Check if already an assigned user in this organization
    const existing = Array.from(inMemoryDb.assignedUsers.values()).find(
      au => au.organization_id === organizationId && au.user_id === profile!.id
    );

    if (existing) {
      return { success: false, error: 'This user is already added to your organization.' };
    }

    const assignedUser: AssignedUser = {
      id: uuidv4(),
      organization_id: organizationId,
      user_id: profile.id,
      email: profile.email,
      invited_by: invitedByUserId,
      status: 'active',
      created_at: new Date().toISOString(),
    };

    inMemoryDb.assignedUsers.set(assignedUser.id, assignedUser);

    // Audit log
    inMemoryDb.auditLogs.unshift({
      id: uuidv4(),
      organization_id: organizationId,
      user_id: invitedByUserId,
      action: 'SUBORDINATE_USER_INVITED',
      resource_type: 'assigned_user',
      resource_id: assignedUser.id,
      details: { email: profile.email, assignedUserId: profile.id },
      created_at: new Date().toISOString(),
    });

    return { success: true, user: assignedUser };
  }

  /**
   * Assign or update permissions for a device to an assigned user
   */
  static assignDevice(
    organizationId: string,
    deviceId: string,
    assignedUserId: string,
    assignedByUserId: string,
    permissions: { can_view?: boolean; can_control?: boolean; can_share?: boolean }
  ): { success: boolean; assignment?: DeviceAssignment; error?: string } {
    // Verify device belongs to this organization
    const device = inMemoryDb.devices.get(deviceId);
    if (!device || device.organization_id !== organizationId) {
      return { success: false, error: 'Device not found in your organization.' };
    }

    // Verify user is an assigned user of this organization
    const au = Array.from(inMemoryDb.assignedUsers.values()).find(
      u => u.organization_id === organizationId && u.user_id === assignedUserId
    );
    if (!au) {
      return { success: false, error: 'Target user is not registered in this organization.' };
    }

    // Check existing assignment
    let assignment = Array.from(inMemoryDb.deviceAssignments.values()).find(
      da => da.device_id === deviceId && da.assigned_user_id === assignedUserId
    );

    if (assignment) {
      assignment.can_view = permissions.can_view ?? assignment.can_view;
      assignment.can_control = permissions.can_control ?? assignment.can_control;
      assignment.can_share = permissions.can_share ?? assignment.can_share;
      assignment.updated_at = new Date().toISOString();
    } else {
      assignment = {
        id: uuidv4(),
        organization_id: organizationId,
        device_id: deviceId,
        assigned_user_id: assignedUserId,
        can_view: permissions.can_view ?? true,
        can_control: permissions.can_control ?? false,
        can_share: permissions.can_share ?? false,
        assigned_by: assignedByUserId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      inMemoryDb.deviceAssignments.set(assignment.id, assignment);
    }

    // Audit log
    inMemoryDb.auditLogs.unshift({
      id: uuidv4(),
      organization_id: organizationId,
      user_id: assignedByUserId,
      action: 'DEVICE_ASSIGNED',
      resource_type: 'device_assignment',
      resource_id: assignment.id,
      details: { deviceId, assignedUserId, permissions },
      created_at: new Date().toISOString(),
    });

    return { success: true, assignment };
  }

  /**
   * Revoke device assignment
   */
  static revokeDeviceAssignment(organizationId: string, deviceId: string, assignedUserId: string, revokedByUserId: string): boolean {
    let targetKey: string | null = null;
    for (const [key, da] of inMemoryDb.deviceAssignments.entries()) {
      if (da.device_id === deviceId && da.assigned_user_id === assignedUserId && da.organization_id === organizationId) {
        targetKey = key;
        break;
      }
    }

    if (!targetKey) return false;

    inMemoryDb.deviceAssignments.delete(targetKey);

    // Audit log
    inMemoryDb.auditLogs.unshift({
      id: uuidv4(),
      organization_id: organizationId,
      user_id: revokedByUserId,
      action: 'DEVICE_ASSIGNMENT_REVOKED',
      resource_type: 'device_assignment',
      resource_id: targetKey,
      details: { deviceId, assignedUserId },
      created_at: new Date().toISOString(),
    });

    return true;
  }

  /**
   * Securely retrieve the device URL and active PIN for an assigned user or owner
   */
  static async getDeviceAccessCredentials(
    deviceId: string,
    organizationId: string,
    userId: string,
    userRole: string
  ): Promise<{ url: string; pin: string } | null> {
    // If assigned user, verify permissions
    if (userRole === 'assigned_user') {
      const assignment = Array.from(inMemoryDb.deviceAssignments.values()).find(
        da => da.device_id === deviceId && da.assigned_user_id === userId && da.can_view
      );
      if (!assignment) return null;
    }

    // Find active share or create one if none exists
    let share = SharingService.getShareForDevice(deviceId, organizationId);
    let pin = share?.pin_preview;

    if (!share) {
      const created = await SharingService.createShare(deviceId, organizationId, userId, {
        allowControl: true,
        expirationHours: 72,
      });
      share = created.share;
      pin = created.plainPin;
    }

    return {
      url: `/share/${share.share_token}`,
      pin: pin || '******',
    };
  }
}
