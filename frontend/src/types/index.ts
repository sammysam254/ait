export interface User {
  id: string;
  email: string;
  fullName: string;
  role: 'admin' | 'customer' | 'assigned_user';
  organizationId: string;
  organizationName?: string;
  plan?: string;
}

export interface Device {
  id: string;
  organization_id: string;
  agent_id: string;
  adb_serial: string;
  device_name: string;
  model: string;
  manufacturer: string;
  android_version: string;
  sdk_version: number;
  screen_width: number;
  screen_height: number;
  screen_density: number;
  connection_type: 'usb' | 'wifi';
  status: 'online' | 'offline' | 'streaming' | 'busy' | 'unauthorized';
  last_seen: string;
  created_at: string;
  permissions?: {
    can_view: boolean;
    can_control: boolean;
    can_share: boolean;
  };
}

export interface Agent {
  id: string;
  organization_id: string;
  computer_name: string;
  os_version: string;
  arch: string;
  agent_version: string;
  ip_address: string;
  status: 'online' | 'offline' | 'revoked';
  last_heartbeat: string;
  cloudflare_tunnel_id?: string;
  created_at: string;
  deviceCount?: number;
}

export interface DeviceShare {
  id: string;
  organization_id: string;
  device_id: string;
  share_token: string;
  pin_preview: string;
  allow_control: boolean;
  expires_at: string;
  max_uses: number;
  current_uses: number;
  is_revoked: boolean;
  created_at: string;
}

export interface AssignedUser {
  id: string;
  organization_id: string;
  user_id: string;
  email: string;
  status: 'pending' | 'active' | 'suspended';
  created_at: string;
  assignedDevicesCount?: number;
}

export interface AuditLog {
  id: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  details: Record<string, any>;
  created_at: string;
}
