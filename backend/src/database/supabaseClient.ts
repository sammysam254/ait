import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';

let supabaseClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient | null {
  if (!supabaseClient) {
    if (config.supabaseUrl && config.supabaseServiceRoleKey) {
      try {
        supabaseClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        });
      } catch (err) {
        console.warn('[Database] Failed to init Supabase client:', err);
      }
    }
  }
  return supabaseClient;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  avatar_url?: string;
  system_role: 'admin' | 'customer' | 'assigned_user';
  created_at: string;
  updated_at: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  plan: 'starter' | 'pro' | 'enterprise';
  max_devices: number;
  max_agents: number;
  created_at: string;
  updated_at: string;
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
  auth_token_hash: string;
  last_heartbeat: string;
  cloudflare_tunnel_id?: string;
  created_at: string;
  updated_at: string;
}

export interface EnrollmentToken {
  id: string;
  organization_id: string;
  token_hash: string;
  token_plain?: string;
  name: string;
  expires_at: string;
  used_at?: string;
  is_revoked: boolean;
  created_by?: string;
  created_at: string;
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
  updated_at: string;
}

export interface DeviceShare {
  id: string;
  organization_id: string;
  device_id: string;
  share_token: string;
  pin_hash: string;
  pin_preview: string;
  allow_control: boolean;
  expires_at: string;
  max_uses: number;
  current_uses: number;
  failed_attempts: number;
  locked_until?: string;
  is_revoked: boolean;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface AssignedUser {
  id: string;
  organization_id: string;
  user_id: string;
  email: string;
  invited_by: string;
  status: 'pending' | 'active' | 'suspended';
  created_at: string;
}

export interface DeviceAssignment {
  id: string;
  organization_id: string;
  device_id: string;
  assigned_user_id: string;
  can_view: boolean;
  can_control: boolean;
  can_share: boolean;
  assigned_by: string;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  organization_id?: string;
  user_id?: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  details: Record<string, any>;
  ip_address?: string;
  created_at: string;
}

// Clean Production In-Memory Database (No fake devices/agents seeded)
class InMemoryDatabase {
  profiles: Map<string, Profile> = new Map();
  organizations: Map<string, Organization> = new Map();
  agents: Map<string, Agent> = new Map();
  enrollmentTokens: Map<string, EnrollmentToken> = new Map();
  devices: Map<string, Device> = new Map();
  deviceShares: Map<string, DeviceShare> = new Map();
  assignedUsers: Map<string, AssignedUser> = new Map();
  deviceAssignments: Map<string, DeviceAssignment> = new Map();
  auditLogs: AuditLog[] = [];

  constructor() {
    this.seedSuperAdmin();
  }

  private seedSuperAdmin() {
    // Permanent Super Admin account for sammyseth260@gmail.com
    const adminId = '11111111-1111-1111-1111-111111111111';
    const adminOrgId = 'aaaa0000-0000-0000-0000-000000000001';

    this.profiles.set(adminId, {
      id: adminId,
      email: 'sammyseth260@gmail.com',
      full_name: 'Sammy Seth (Super Admin)',
      system_role: 'admin',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    this.organizations.set(adminOrgId, {
      id: adminOrgId,
      name: 'Vertex SaaS Global Operations',
      slug: 'vertex-global',
      owner_id: adminId,
      plan: 'enterprise',
      max_devices: 1000,
      max_agents: 100,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    this.auditLogs.unshift({
      id: 'init-audit-log-01',
      organization_id: adminOrgId,
      action: 'PLATFORM_INITIALIZED',
      resource_type: 'system',
      details: { superAdmin: 'sammyseth260@gmail.com', mode: 'production' },
      created_at: new Date().toISOString(),
    });
  }
}

export const inMemoryDb = new InMemoryDatabase();
