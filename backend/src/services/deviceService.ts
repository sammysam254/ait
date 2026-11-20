import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import { inMemoryDb, Device } from '../database/supabaseClient';
import { AuthenticatedUser } from '../middleware/auth';

const VERTEX_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

export class DeviceService {
  /**
   * Helper to collect all string identifiers associated with an authenticated user:
   * user.id, user.email, and all associated AssignedUser records (id, user_id, email).
   */
  private static getUserIdentifierSet(user: AuthenticatedUser): Set<string> {
    const ids = new Set<string>();
    if (user.id) ids.add(user.id.toLowerCase().trim());
    if (user.email) ids.add(user.email.toLowerCase().trim());

    const cleanEmail = (user.email || '').toLowerCase().trim();
    const cleanId = (user.id || '').toLowerCase().trim();

    for (const au of inMemoryDb.assignedUsers.values()) {
      const match =
        (cleanId && au.user_id && au.user_id.toLowerCase().trim() === cleanId) ||
        (cleanEmail && au.email && au.email.toLowerCase().trim() === cleanEmail) ||
        (cleanId && au.id && au.id.toLowerCase().trim() === cleanId);

      if (match) {
        if (au.id) ids.add(au.id.toLowerCase().trim());
        if (au.user_id) ids.add(au.user_id.toLowerCase().trim());
        if (au.email) ids.add(au.email.toLowerCase().trim());
      }
    }
    return ids;
  }

  /**
   * Helper to find all active device assignments for a user.
   */
  private static getUserAssignments(user: AuthenticatedUser) {
    const userIdentifiers = this.getUserIdentifierSet(user);
    return Array.from(inMemoryDb.deviceAssignments.values()).filter(da => {
      if (da.can_view === false) return false;
      const target = (da.assigned_user_id || '').toLowerCase().trim();
      return userIdentifiers.has(target);
    });
  }

  /**
   * Retrieves devices accessible by the authenticated user.
   * Enforces strict multi-tenant isolation and assigned-user boundaries.
   */
  static listDevicesForUser(user: AuthenticatedUser): (Device & { permissions?: { can_view: boolean; can_control: boolean; can_share: boolean } })[] {
    const allDevices = Array.from(inMemoryDb.devices.values());

    if (user.system_role === 'admin') {
      return allDevices.map(d => ({
        ...d,
        permissions: { can_view: true, can_control: true, can_share: true }
      }));
    }

    const userAssignments = this.getUserAssignments(user);
    const assignedMap = new Map<string, any>();
    for (const a of userAssignments) {
      assignedMap.set(a.device_id, a);
    }

    // Devices explicitly assigned to this user
    const assignedDevices = allDevices
      .filter(d => assignedMap.has(d.id) || (d.adb_serial && assignedMap.has(d.adb_serial)))
      .map(d => {
        const assignment = assignedMap.get(d.id) || assignedMap.get(d.adb_serial)!;
        return {
          ...d,
          permissions: {
            can_view: assignment.can_view ?? true,
            can_control: assignment.can_control ?? false,
            can_share: assignment.can_share ?? false,
          }
        };
      });

    // Ensure every assigned device appears in the worker's fleet (even if temporarily offline or syncing)
    for (const [devId, assignment] of assignedMap.entries()) {
      const alreadyInList = assignedDevices.some(d => d.id === devId || d.adb_serial === devId);
      if (!alreadyInList) {
        const found = allDevices.find(d => d.id === devId || d.adb_serial === devId);
        if (found) {
          assignedDevices.push({
            ...found,
            permissions: {
              can_view: assignment.can_view ?? true,
              can_control: assignment.can_control ?? false,
              can_share: assignment.can_share ?? false,
            }
          });
        } else {
          assignedDevices.push({
            id: devId,
            organization_id: assignment.organization_id || user.organizationId,
            agent_id: '',
            adb_serial: devId,
            device_name: 'Assigned Android Device',
            model: 'Android Phone',
            manufacturer: 'Generic',
            android_version: '14',
            sdk_version: 34,
            screen_width: 720,
            screen_height: 1600,
            screen_density: 300,
            connection_type: 'usb',
            status: 'offline',
            last_seen: assignment.updated_at || assignment.created_at,
            created_at: assignment.created_at,
            updated_at: assignment.updated_at,
            permissions: {
              can_view: assignment.can_view ?? true,
              can_control: assignment.can_control ?? false,
              can_share: assignment.can_share ?? false,
            }
          });
        }
      }
    }

    if (user.system_role === 'customer') {
      // Return devices belonging to this customer's organization + any devices assigned to them
      const ownedDevices = allDevices
        .filter(d => d.organization_id === user.organizationId)
        .map(d => ({
          ...d,
          permissions: { can_view: true, can_control: true, can_share: true }
        }));

      // Combine owned and assigned (deduplicated by id)
      const resultMap = new Map<string, any>();
      for (const d of ownedDevices) resultMap.set(d.id, d);
      for (const d of assignedDevices) {
        if (!resultMap.has(d.id)) resultMap.set(d.id, d);
      }
      return Array.from(resultMap.values());
    }

    // Subordinate account / worker: can see all devices explicitly assigned to them
    return assignedDevices;
  }

  /**
   * Retrieves a single device with strict tenant isolation check.
   */
  static getDeviceById(deviceId: string, user: AuthenticatedUser): { device?: Device; permissions?: any; error?: string; status: number } {
    let device = inMemoryDb.devices.get(deviceId);
    if (!device) {
      // 1. Direct serial lookup
      for (const dev of inMemoryDb.devices.values()) {
        if (dev.adb_serial === deviceId) {
          device = dev;
          break;
        }
      }
      // 2. Fallback: Only alias if there is EXACTLY ONE device in the tenant (avoids cross-device collisions when multiple phones exist)
      if (!device) {
        const orgDevices = Array.from(inMemoryDb.devices.values()).filter(d =>
          user.system_role === 'admin' || d.organization_id === user.organizationId
        );
        if (orgDevices.length === 1) {
          device = orgDevices[0];
        }
      }
    }
    if (!device) {
      return { status: 404, error: 'Device not found.' };
    }

    // Platform admin check
    if (user.system_role === 'admin') {
      return { status: 200, device, permissions: { can_view: true, can_control: true, can_share: true } };
    }

    // Check if device is explicitly assigned to this user
    const userAssignments = this.getUserAssignments(user);
    const assignment = userAssignments.find(a => a.device_id === device!.id && a.can_view);
    if (assignment) {
      return {
        status: 200,
        device,
        permissions: {
          can_view: assignment.can_view ?? true,
          can_control: assignment.can_control ?? false,
          can_share: assignment.can_share ?? false,
        }
      };
    }

    // Customer owner check: must belong to the exact same organization
    if (user.system_role === 'customer') {
      if (device.organization_id !== user.organizationId) {
        // Critical: Reject cross-tenant access!
        return { status: 403, error: 'Access denied. You do not own this device.' };
      }
      return { status: 200, device, permissions: { can_view: true, can_control: true, can_share: true } };
    }

    return { status: 403, error: 'Access denied. Device is not assigned to your account.' };
  }

  /**
   * Synchronizes detected devices reported by a Windows Agent
   */
  static syncAgentDevices(
    agentId: string,
    organizationId: string,
    detectedDevices: Array<{
      adbSerial: string;
      deviceName?: string;
      model?: string;
      manufacturer?: string;
      androidVersion?: string;
      sdkVersion?: number;
      screenWidth?: number;
      screenHeight?: number;
      screenDensity?: number;
      connectionType?: 'usb' | 'wifi';
      status?: 'online' | 'offline' | 'unauthorized';
    }>
  ): Device[] {
    const registered: Device[] = [];
    const detectedSerials = new Set(detectedDevices.map(d => d.adbSerial));

    for (const d of detectedDevices) {
      // Find existing device by organizationId and adbSerial (stable across agent restarts)
      let existing: Device | undefined;
      for (const dev of inMemoryDb.devices.values()) {
        if (dev.organization_id === organizationId && dev.adb_serial === d.adbSerial) {
          existing = dev;
          existing.agent_id = agentId;
          break;
        }
      }

      if (existing) {
        existing.status = d.status || 'online';
        existing.last_seen = new Date().toISOString();
        if (d.deviceName) existing.device_name = d.deviceName;
        if (d.model) existing.model = d.model;
        if (d.manufacturer) existing.manufacturer = d.manufacturer;
        if (d.androidVersion) existing.android_version = d.androidVersion;
        if (d.screenWidth) existing.screen_width = d.screenWidth;
        if (d.screenHeight) existing.screen_height = d.screenHeight;
        existing.updated_at = new Date().toISOString();
        registered.push(existing);
      } else {
        const stableId = uuidv5(`${organizationId}:${d.adbSerial}`, VERTEX_NAMESPACE);
        const newDevice: Device = {
          id: stableId,
          organization_id: organizationId,
          agent_id: agentId,
          adb_serial: d.adbSerial,
          device_name: d.deviceName || `Android (${d.adbSerial.slice(0, 8)})`,
          model: d.model || 'Android Generic',
          manufacturer: d.manufacturer || 'Android',
          android_version: d.androidVersion || '14',
          sdk_version: d.sdkVersion || 34,
          screen_width: d.screenWidth || 1080,
          screen_height: d.screenHeight || 2400,
          screen_density: d.screenDensity || 420,
          connection_type: d.connectionType || 'usb',
          status: d.status || 'online',
          last_seen: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        inMemoryDb.devices.set(newDevice.id, newDevice);
        registered.push(newDevice);

        // Audit log
        inMemoryDb.auditLogs.unshift({
          id: uuidv4(),
          organization_id: organizationId,
          action: 'DEVICE_DETECTED_AND_REGISTERED',
          resource_type: 'device',
          resource_id: newDevice.id,
          details: { serial: d.adbSerial, model: newDevice.model },
          created_at: new Date().toISOString(),
        });
      }
    }

    // Mark any devices belonging to this agent that were NOT detected as offline
    for (const dev of inMemoryDb.devices.values()) {
      if (dev.agent_id === agentId && !detectedSerials.has(dev.adb_serial)) {
        if (dev.status !== 'offline') {
          dev.status = 'offline';
          dev.updated_at = new Date().toISOString();
        }
      }
    }

    inMemoryDb.save();

    return registered;
  }

  /**
   * Updates device status (e.g. streaming, offline)
   */
  static updateStatus(deviceId: string, status: 'online' | 'offline' | 'streaming' | 'busy' | 'unauthorized'): boolean {
    const dev = inMemoryDb.devices.get(deviceId);
    if (!dev) return false;
    dev.status = status;
    dev.updated_at = new Date().toISOString();
    return true;
  }
}
