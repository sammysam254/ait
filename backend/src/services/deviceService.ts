import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import { inMemoryDb, Device } from '../database/supabaseClient';
import { AuthenticatedUser } from '../middleware/auth';

const VERTEX_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

export class DeviceService {
  /**
   * Retrieves devices accessible by the authenticated user.
   * Enforces strict multi-tenant isolation and assigned-user boundaries.
   */
  static listDevicesForUser(user: AuthenticatedUser): (Device & { permissions?: { can_view: boolean; can_control: boolean; can_share: boolean } })[] {
    const allDevices = Array.from(inMemoryDb.devices.values());

    if (user.system_role === 'admin') {
      return allDevices;
    }

    if (user.system_role === 'customer') {
      // Return only devices belonging to this customer's organization
      return allDevices
        .filter(d => d.organization_id === user.organizationId)
        .map(d => ({
          ...d,
          permissions: { can_view: true, can_control: true, can_share: true }
        }));
    }

    if (user.system_role === 'assigned_user') {
      // Subordinate account: can ONLY see devices explicitly assigned to them
      const userAssignments = Array.from(inMemoryDb.deviceAssignments.values())
        .filter(da => da.assigned_user_id === user.id && da.can_view);

      const assignedDeviceIds = new Set(userAssignments.map(a => a.device_id));

      return allDevices
        .filter(d => assignedDeviceIds.has(d.id))
        .map(d => {
          const assignment = userAssignments.find(a => a.device_id === d.id);
          return {
            ...d,
            permissions: {
              can_view: assignment?.can_view ?? true,
              can_control: assignment?.can_control ?? false,
              can_share: assignment?.can_share ?? false,
            }
          };
        });
    }

    return [];
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

    // Customer owner check: must belong to the exact same organization
    if (user.system_role === 'customer') {
      if (device.organization_id !== user.organizationId) {
        // Critical: Reject cross-tenant access!
        return { status: 403, error: 'Access denied. You do not own this device.' };
      }
      return { status: 200, device, permissions: { can_view: true, can_control: true, can_share: true } };
    }

    // Assigned user check: must have explicit assignment record
    if (user.system_role === 'assigned_user') {
      const assignment = Array.from(inMemoryDb.deviceAssignments.values()).find(
        a => a.device_id === deviceId && a.assigned_user_id === user.id && a.can_view
      );
      if (!assignment) {
        return { status: 403, error: 'Access denied. Device is not assigned to your account.' };
      }
      return {
        status: 200,
        device,
        permissions: {
          can_view: assignment.can_view,
          can_control: assignment.can_control,
          can_share: assignment.can_share,
        }
      };
    }

    return { status: 403, error: 'Unauthorized.' };
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
