import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';

let supabaseClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient | null {
  if (!supabaseClient) {
    if (config.supabaseUrl && config.supabaseServiceRoleKey && !config.supabaseUrl.includes('demo-vertex-saas')) {
      try {
        supabaseClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        });
      } catch (err) {
        console.warn('[Database] Failed to init Supabase client with provided credentials:', err);
      }
    }
  }
  return supabaseClient;
}

// In-Memory Storage for Standalone/Local Resilient Operation and Immediate Acceptance Testing
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

// Initial In-Memory State Populated with Seed Entities
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
    this.seedDefaults();
  }

  private seedDefaults() {
    // 1. Super Admin
    this.profiles.set('11111111-1111-1111-1111-111111111111', {
      id: '11111111-1111-1111-1111-111111111111',
      email: 'admin@vertex-saas.local',
      full_name: 'Platform Super Admin',
      system_role: 'admin',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // 2. Customer A
    const custAId = '22222222-2222-2222-2222-222222222222';
    const orgAId = 'aaaa0000-0000-0000-0000-000000000001';
    this.profiles.set(custAId, {
      id: custAId,
      email: 'customerA@enterprise.local',
      full_name: 'Customer A (Dev Operations)',
      system_role: 'customer',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    this.organizations.set(orgAId, {
      id: orgAId,
      name: 'Customer A Lab',
      slug: 'customer-a-lab',
      owner_id: custAId,
      plan: 'pro',
      max_devices: 20,
      max_agents: 5,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // 3. Customer B
    const custBId = '33333333-3333-3333-3333-333333333333';
    const orgBId = 'bbbb0000-0000-0000-0000-000000000002';
    this.profiles.set(custBId, {
      id: custBId,
      email: 'customerB@fintech.local',
      full_name: 'Customer B (QA Testing Lab)',
      system_role: 'customer',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    this.organizations.set(orgBId, {
      id: orgBId,
      name: 'Customer B Testing Farm',
      slug: 'customer-b-farm',
      owner_id: custBId,
      plan: 'starter',
      max_devices: 5,
      max_agents: 2,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // 4. Assigned User
    const assignedUserId = '44444444-4444-4444-4444-444444444444';
    this.profiles.set(assignedUserId, {
      id: assignedUserId,
      email: 'assigned.user@partner.local',
      full_name: 'Subordinate Tester John',
      system_role: 'assigned_user',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    this.assignedUsers.set('assign01-aaaa-0000-0000-000000000001', {
      id: 'assign01-aaaa-0000-0000-000000000001',
      organization_id: orgAId,
      user_id: assignedUserId,
      email: 'assigned.user@partner.local',
      invited_by: custAId,
      status: 'active',
      created_at: new Date().toISOString(),
    });

    // Seed Agents
    const agentAId = 'agent001-aaaa-0000-0000-000000000001';
    this.agents.set(agentAId, {
      id: agentAId,
      organization_id: orgAId,
      computer_name: 'WIN-HOST-OFFICE-01',
      os_version: 'Windows 11 Pro 24H2',
      arch: 'x64',
      agent_version: '1.0.0',
      ip_address: '192.168.1.105',
      status: 'online',
      auth_token_hash: 'sample_token_hash_a',
      last_heartbeat: new Date().toISOString(),
      cloudflare_tunnel_id: 'cf-tunnel-customer-a',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const agentBId = 'agent002-bbbb-0000-0000-000000000002';
    this.agents.set(agentBId, {
      id: agentBId,
      organization_id: orgBId,
      computer_name: 'QA-RIG-DESKTOP-04',
      os_version: 'Windows 10 Enterprise',
      arch: 'x64',
      agent_version: '1.0.0',
      ip_address: '10.0.0.45',
      status: 'online',
      auth_token_hash: 'sample_token_hash_b',
      last_heartbeat: new Date().toISOString(),
      cloudflare_tunnel_id: 'cf-tunnel-customer-b',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Seed Customer A's devices
    const devA1 = 'dev00001-aaaa-0000-0000-000000000001';
    this.devices.set(devA1, {
      id: devA1,
      organization_id: orgAId,
      agent_id: agentAId,
      adb_serial: 'R5CN80ABC1D',
      device_name: 'Samsung Galaxy S23 Ultra',
      model: 'SM-S918B',
      manufacturer: 'Samsung',
      android_version: '14',
      sdk_version: 34,
      screen_width: 1440,
      screen_height: 3088,
      screen_density: 500,
      connection_type: 'usb',
      status: 'online',
      last_seen: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const devA2 = 'dev00002-aaaa-0000-0000-000000000002';
    this.devices.set(devA2, {
      id: devA2,
      organization_id: orgAId,
      agent_id: agentAId,
      adb_serial: '192.168.1.150:5555',
      device_name: 'Google Pixel 8 Pro',
      model: 'Pixel 8 Pro',
      manufacturer: 'Google',
      android_version: '14',
      sdk_version: 34,
      screen_width: 1344,
      screen_height: 2992,
      screen_density: 480,
      connection_type: 'wifi',
      status: 'online',
      last_seen: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Seed Customer B's device (strictly isolated!)
    const devB1 = 'dev00003-bbbb-0000-0000-000000000003';
    this.devices.set(devB1, {
      id: devB1,
      organization_id: orgBId,
      agent_id: agentBId,
      adb_serial: 'ZY3223GTR5',
      device_name: 'Motorola Edge 50 Pro',
      model: 'XT2403-1',
      manufacturer: 'Motorola',
      android_version: '14',
      sdk_version: 34,
      screen_width: 1220,
      screen_height: 2712,
      screen_density: 446,
      connection_type: 'usb',
      status: 'online',
      last_seen: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Assign Customer A's Device 1 to Subordinate Assigned User
    this.deviceAssignments.set('da000001-aaaa-0000-0000-000000000001', {
      id: 'da000001-aaaa-0000-0000-000000000001',
      organization_id: orgAId,
      device_id: devA1,
      assigned_user_id: assignedUserId,
      can_view: true,
      can_control: true,
      can_share: false,
      assigned_by: custAId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Seed Sample Share Link (PIN: 849201)
    // bcrypt hash of '849201': $2a$10$e7QhK6uEom8U7K1WpT1eEOtL8rC5oZ3m9i2s1k5j3o9u4n7x9p4v.
    this.deviceShares.set('share001-aaaa-0000-0000-000000000001', {
      id: 'share001-aaaa-0000-0000-000000000001',
      organization_id: orgAId,
      device_id: devA1,
      share_token: 'vtx_demo_share_token_8842',
      pin_hash: '$2a$10$e7QhK6uEom8U7K1WpT1eEOtL8rC5oZ3m9i2s1k5j3o9u4n7x9p4v.',
      pin_preview: '849201',
      allow_control: true,
      expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      max_uses: 25,
      current_uses: 1,
      failed_attempts: 0,
      is_revoked: false,
      created_by: custAId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
}

export const inMemoryDb = new InMemoryDatabase();
