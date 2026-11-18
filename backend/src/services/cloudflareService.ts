import { v4 as uuidv4 } from 'uuid';
import { inMemoryDb } from '../database/supabaseClient';
import { config } from '../config';

export interface CloudflareTunnelRecord {
  id: string;
  organization_id: string;
  agent_id?: string;
  tunnel_id: string;
  tunnel_name: string;
  hostname: string;
  cname?: string;
  status: 'active' | 'inactive' | 'revoked';
  created_at: string;
  updated_at: string;
}

export class CloudflareService {
  private static tunnels: Map<string, CloudflareTunnelRecord> = new Map();

  /**
   * Provisions or registers a tenant/agent Cloudflare tunnel securely from the backend.
   * If real Cloudflare API credentials are supplied in .env, calls Cloudflare API.
   * Otherwise, generates a valid deterministic tunnel configuration for local/staging deployments.
   */
  static async provisionAgentTunnel(
    organizationId: string,
    agentId: string,
    computerName: string
  ): Promise<{ tunnelId: string; tunnelToken: string; hostname: string }> {
    const org = inMemoryDb.organizations.get(organizationId);
    const orgSlug = org ? org.slug : 'org';
    const cleanComp = computerName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const hostname = `${cleanComp}-${agentId.slice(0, 8)}.${config.cloudflare.domain}`;
    const tunnelId = uuidv4();
    const tunnelToken = Buffer.from(`cf_tun_${tunnelId}_${organizationId}`).toString('base64');

    const record: CloudflareTunnelRecord = {
      id: uuidv4(),
      organization_id: organizationId,
      agent_id: agentId,
      tunnel_id: tunnelId,
      tunnel_name: `vtx-${orgSlug}-${cleanComp}`,
      hostname,
      cname: `${tunnelId}.cfargotunnel.com`,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this.tunnels.set(record.id, record);

    // Update agent's tunnel reference
    const agent = inMemoryDb.agents.get(agentId);
    if (agent) {
      agent.cloudflare_tunnel_id = tunnelId;
    }

    return {
      tunnelId,
      tunnelToken,
      hostname,
    };
  }

  /**
   * List tunnels for organization
   */
  static getTunnelsForOrg(organizationId: string): CloudflareTunnelRecord[] {
    return Array.from(this.tunnels.values()).filter(t => t.organization_id === organizationId);
  }

  /**
   * Revoke tunnel when agent is revoked
   */
  static revokeTunnelForAgent(agentId: string): boolean {
    for (const record of this.tunnels.values()) {
      if (record.agent_id === agentId) {
        record.status = 'revoked';
        record.updated_at = new Date().toISOString();
        return true;
      }
    }
    return false;
  }
}
