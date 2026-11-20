import { v4 as uuidv4 } from 'uuid';
import { inMemoryDb, AssignedUser, DeviceAssignment, Profile, Invitation } from '../database/supabaseClient';
import { SharingService } from './sharingService';
import { EmailService } from './emailService';
import { config } from '../config';

export class AssignmentService {
  /**
   * List subordinate assigned users for the organization, including their assigned device count
   */
  static listAssignedUsers(organizationId: string): Array<AssignedUser & { assignedDevicesCount: number; assignedDevices: any[] }> {
    return Array.from(inMemoryDb.assignedUsers.values())
      .filter(au => au.organization_id === organizationId)
      .map(au => {
        const userAssignments = Array.from(inMemoryDb.deviceAssignments.values())
          .filter(da => (da.assigned_user_id === au.user_id || da.assigned_user_id === au.email.toLowerCase()) && da.organization_id === organizationId);
        
        const assignedDevices = userAssignments.map(da => {
          const dev = inMemoryDb.devices.get(da.device_id);
          return {
            assignmentId: da.id,
            deviceId: da.device_id,
            deviceName: dev?.device_name || 'Android Device',
            model: dev?.model || 'Generic',
            status: dev?.status || 'offline',
            canView: da.can_view,
            canControl: da.can_control,
            canShare: da.can_share,
          };
        });

        return {
          ...au,
          assignedDevicesCount: userAssignments.length,
          assignedDevices,
        };
      });
  }

  /**
   * Invite a subordinate user under the customer's organization.
   * Generates a secure invite token, sets up the pending invitation & assigned user record,
   * sends the invitation email, and returns the direct registration URL.
   */
  static async inviteSubordinateUser(
    organizationId: string,
    invitedByUserId: string,
    email: string,
    fullName?: string
  ): Promise<{ success: boolean; user?: AssignedUser; inviteUrl?: string; token?: string; error?: string }> {
    const cleanEmail = email.toLowerCase().trim();

    // Check if user profile already exists with primary customer or admin role
    const existingProfile = Array.from(inMemoryDb.profiles.values()).find(p => p.email.toLowerCase() === cleanEmail);
    if (existingProfile && (existingProfile.system_role === 'customer' || existingProfile.system_role === 'admin')) {
      return { success: false, error: 'A primary account owner or admin account already exists with this email.' };
    }

    // Check if already an assigned user in this organization
    let assignedUser = Array.from(inMemoryDb.assignedUsers.values()).find(
      au => au.organization_id === organizationId && (au.email.toLowerCase() === cleanEmail || (existingProfile && au.user_id === existingProfile.id))
    );

    const pendingUserId = existingProfile ? existingProfile.id : uuidv4();

    if (!assignedUser) {
      assignedUser = {
        id: uuidv4(),
        organization_id: organizationId,
        user_id: pendingUserId,
        email: cleanEmail,
        invited_by: invitedByUserId,
        status: 'pending',
        created_at: new Date().toISOString(),
      };
      inMemoryDb.assignedUsers.set(assignedUser.id, assignedUser);
    } else {
      assignedUser.status = 'pending';
    }

    // If profile doesn't exist yet, seed a pre-registered assigned_user profile
    if (!existingProfile) {
      const profile: Profile = {
        id: pendingUserId,
        email: cleanEmail,
        full_name: fullName || cleanEmail.split('@')[0],
        system_role: 'assigned_user',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      inMemoryDb.profiles.set(pendingUserId, profile);
    }

    // Generate unique invitation token
    const inviteToken = 'vtx_inv_' + uuidv4().replace(/-/g, '');
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(); // 7 days

    // Invalidate any older invitations for this email in this org
    for (const inv of inMemoryDb.invitations.values()) {
      if (inv.organization_id === organizationId && inv.email.toLowerCase() === cleanEmail && inv.status === 'pending') {
        inv.status = 'expired';
      }
    }

    const invitation: Invitation = {
      id: uuidv4(),
      token: inviteToken,
      organization_id: organizationId,
      invited_by: invitedByUserId,
      email: cleanEmail,
      full_name: fullName || cleanEmail.split('@')[0],
      status: 'pending',
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
    };
    inMemoryDb.invitations.set(invitation.id, invitation);

    // Build the direct registration link
    const inviteUrl = `${config.frontendUrl}/register?inviteToken=${inviteToken}&email=${encodeURIComponent(cleanEmail)}`;

    // Inviter info for email
    const inviter = inMemoryDb.profiles.get(invitedByUserId);
    const org = inMemoryDb.organizations.get(organizationId);

    // Dispatch email asynchronously
    await EmailService.sendInviteEmail({
      to: cleanEmail,
      fullName: fullName || cleanEmail.split('@')[0],
      inviterName: inviter?.full_name || 'Account Owner',
      orgName: org?.name || 'Vertex Cloud Device Farm',
      inviteToken,
      inviteUrl,
    });

    // Audit log
    inMemoryDb.auditLogs.unshift({
      id: uuidv4(),
      organization_id: organizationId,
      user_id: invitedByUserId,
      action: 'SUBORDINATE_USER_INVITED',
      resource_type: 'assigned_user',
      resource_id: assignedUser.id,
      details: { email: cleanEmail, inviteToken, expiresAt },
      created_at: new Date().toISOString(),
    });

    return {
      success: true,
      user: assignedUser,
      inviteUrl,
      token: inviteToken,
    };
  }

  /**
   * Verify an invitation token for the registration page
   */
  static verifyInviteToken(token: string): { valid: boolean; email?: string; fullName?: string; orgName?: string; error?: string } {
    const invite = Array.from(inMemoryDb.invitations.values()).find(i => i.token === token);
    if (!invite) {
      return { valid: false, error: 'Invitation link not found or invalid.' };
    }

    if (invite.status === 'expired' || new Date(invite.expires_at).getTime() < Date.now()) {
      return { valid: false, error: 'This invitation has expired. Please ask the account owner for a new one.' };
    }

    if (invite.status === 'accepted') {
      return { valid: false, error: 'This invitation has already been accepted. Please sign in directly.' };
    }

    const org = inMemoryDb.organizations.get(invite.organization_id);

    return {
      valid: true,
      email: invite.email,
      fullName: invite.full_name,
      orgName: org?.name || 'Vertex Cloud Device Farm',
    };
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

    // Verify user is registered/invited in this organization
    const au = Array.from(inMemoryDb.assignedUsers.values()).find(
      u => u.organization_id === organizationId && (u.user_id === assignedUserId || u.email.toLowerCase() === assignedUserId.toLowerCase())
    );
    if (!au) {
      return { success: false, error: 'Target user is not registered in this organization.' };
    }

    const targetUserId = au.user_id;

    // Check existing assignment
    let assignment = Array.from(inMemoryDb.deviceAssignments.values()).find(
      da => da.device_id === deviceId && (da.assigned_user_id === targetUserId || da.assigned_user_id === au.email.toLowerCase())
    );

    if (assignment) {
      assignment.assigned_user_id = targetUserId;
      assignment.can_view = permissions.can_view ?? assignment.can_view;
      assignment.can_control = permissions.can_control ?? assignment.can_control;
      assignment.can_share = permissions.can_share ?? assignment.can_share;
      assignment.updated_at = new Date().toISOString();
    } else {
      assignment = {
        id: uuidv4(),
        organization_id: organizationId,
        device_id: deviceId,
        assigned_user_id: targetUserId,
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
      details: { deviceId, assignedUserId: targetUserId, permissions },
      created_at: new Date().toISOString(),
    });

    return { success: true, assignment };
  }

  /**
   * Revoke single device assignment from a user
   */
  static revokeDeviceAssignment(organizationId: string, deviceId: string, assignedUserId: string, revokedByUserId: string): boolean {
    let targetKey: string | null = null;
    for (const [key, da] of inMemoryDb.deviceAssignments.entries()) {
      if (da.device_id === deviceId &&
          (da.assigned_user_id === assignedUserId || da.assigned_user_id.toLowerCase() === assignedUserId.toLowerCase()) &&
          da.organization_id === organizationId) {
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
   * Revoke an assigned user entirely: removes their organization membership and all assigned devices
   */
  static revokeAssignedUser(organizationId: string, assignedUserId: string, revokedByUserId: string): boolean {
    // Find assigned user record
    let targetAuKey: string | null = null;
    let targetUser: AssignedUser | null = null;

    for (const [key, au] of inMemoryDb.assignedUsers.entries()) {
      if (au.organization_id === organizationId && (au.id === assignedUserId || au.user_id === assignedUserId || au.email.toLowerCase() === assignedUserId.toLowerCase())) {
        targetAuKey = key;
        targetUser = au;
        break;
      }
    }

    if (!targetAuKey || !targetUser) return false;

    // Delete all device assignments for this user
    for (const [key, da] of inMemoryDb.deviceAssignments.entries()) {
      if (da.organization_id === organizationId &&
          (da.assigned_user_id === targetUser.user_id || da.assigned_user_id === targetUser.email.toLowerCase())) {
        inMemoryDb.deviceAssignments.delete(key);
      }
    }

    // Invalidate pending invitations
    for (const inv of inMemoryDb.invitations.values()) {
      if (inv.organization_id === organizationId && inv.email.toLowerCase() === targetUser.email.toLowerCase()) {
        inv.status = 'expired';
      }
    }

    // Delete assigned user
    inMemoryDb.assignedUsers.delete(targetAuKey);

    // Audit log
    inMemoryDb.auditLogs.unshift({
      id: uuidv4(),
      organization_id: organizationId,
      user_id: revokedByUserId,
      action: 'SUBORDINATE_USER_REVOKED',
      resource_type: 'assigned_user',
      resource_id: targetAuKey,
      details: { revokedEmail: targetUser.email, revokedUserId: targetUser.user_id },
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
    userRole: string,
    userEmail?: string
  ): Promise<{ url: string; pin: string } | null> {
    // If assigned user, verify permissions
    if (userRole === 'assigned_user') {
      const assignment = Array.from(inMemoryDb.deviceAssignments.values()).find(
        da => da.device_id === deviceId &&
              (da.assigned_user_id === userId || (userEmail && da.assigned_user_id === userEmail.toLowerCase())) &&
              da.can_view
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
