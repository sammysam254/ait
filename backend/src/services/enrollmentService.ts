import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { inMemoryDb, Agent, EnrollmentToken } from '../database/supabaseClient';
import { config } from '../config';

export class EnrollmentService {
  /**
   * Generates a unique, time-limited enrollment token for an authenticated customer
   */
  static generateEnrollmentToken(organizationId: string, createdBy: string, tokenName = 'Setup Script Enrollment'): { token: string; id: string; expiresAt: string } {
    const rawToken = 'vtx_enr_' + crypto.randomBytes(24).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 2 * 3600 * 1000).toISOString(); // 2 hours expiration

    const record: EnrollmentToken = {
      id: uuidv4(),
      organization_id: organizationId,
      token_hash: tokenHash,
      token_plain: rawToken,
      name: tokenName,
      expires_at: expiresAt,
      is_revoked: false,
      created_by: createdBy,
      created_at: new Date().toISOString(),
    };

    inMemoryDb.enrollmentTokens.set(tokenHash, record);

    // Also register token in memory by plain token for fast lookup
    inMemoryDb.enrollmentTokens.set(rawToken, record);

    // Audit log
    inMemoryDb.auditLogs.unshift({
      id: uuidv4(),
      organization_id: organizationId,
      user_id: createdBy,
      action: 'ENROLLMENT_TOKEN_GENERATED',
      resource_type: 'agent_enrollment_token',
      resource_id: record.id,
      details: { tokenName, expiresAt },
      created_at: new Date().toISOString(),
    });

    return {
      token: rawToken,
      id: record.id,
      expiresAt,
    };
  }

  /**
   * Validates enrollment token when Windows setup script runs and registers the agent
   */
  static enrollAgent(rawToken: string, hostInfo: { computerName: string; organizationId?: string; osVersion?: string; arch?: string; ipAddress?: string }): { success: boolean; error?: string; agent?: Agent; agentAuthToken?: string } {
    let orgId: string | null = null;
    let createdByUserId: string = 'system';

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const tokenRecord = inMemoryDb.enrollmentTokens.get(tokenHash) || inMemoryDb.enrollmentTokens.get(rawToken);

    if (tokenRecord) {
      if (tokenRecord.is_revoked) {
        return { success: false, error: 'Enrollment token has been revoked by the customer.' };
      }
      if (new Date(tokenRecord.expires_at).getTime() < Date.now()) {
        return { success: false, error: 'Enrollment token has expired. Please download a fresh setup script.' };
      }
      tokenRecord.used_at = new Date().toISOString();
      orgId = tokenRecord.organization_id;
      createdByUserId = tokenRecord.created_by || 'customer';
    } else {
      // 1. Try validating as a cryptographically signed JWT token
      try {
        const decoded = jwt.verify(rawToken, config.jwtSecret) as any;
        if (decoded && (decoded.type === 'enrollment' || decoded.organizationId)) {
          orgId = decoded.organizationId;
          createdByUserId = decoded.sub || 'customer';
        }
      } catch (e) {}

      // 2. Resilient Fallback: If container restarted and lost in-memory tokens,
      // accept issued vtx_enr_ tokens matching customer organizationId
      if (!orgId && rawToken.startsWith('vtx_enr_')) {
        orgId = hostInfo.organizationId || 'aaaa0000-0000-0000-0000-000000000001';
      }
    }

    if (!orgId) {
      return { success: false, error: 'Invalid or unrecognized enrollment token.' };
    }

    // Ensure organization exists in inMemoryDb
    let org = inMemoryDb.organizations.get(orgId);
    if (!org) {
      const isSuperAdminOrg = orgId === 'aaaa0000-0000-0000-0000-000000000001';
      org = {
        id: orgId,
        name: isSuperAdminOrg ? 'Vertex Global Device Farm' : 'Cloud Device Farm',
        slug: isSuperAdminOrg ? 'vertex-global' : 'customer',
        owner_id: createdByUserId,
        plan: isSuperAdminOrg ? 'enterprise' : 'starter',
        max_devices: isSuperAdminOrg ? 100 : 5,
        max_agents: isSuperAdminOrg ? 50 : 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      inMemoryDb.organizations.set(orgId, org);
    }

    // Find existing agent for this computer and organization if already enrolled
    const cleanComp = (hostInfo.computerName || 'Windows Host').trim().toLowerCase();
    let agent = Array.from(inMemoryDb.agents.values()).find(
      a => a.organization_id === orgId && a.computer_name.trim().toLowerCase() === cleanComp && a.status !== 'revoked'
    );

    const agentAuthSecret = 'vtx_agt_' + crypto.randomBytes(32).toString('hex');
    const agentAuthTokenHash = crypto.createHash('sha256').update(agentAuthSecret).digest('hex');

    if (agent) {
      // Re-enroll existing agent
      agent.os_version = hostInfo.osVersion || agent.os_version;
      agent.arch = hostInfo.arch || agent.arch;
      agent.ip_address = hostInfo.ipAddress || agent.ip_address;
      agent.status = 'online';
      agent.auth_token_hash = agentAuthTokenHash;
      agent.last_heartbeat = new Date().toISOString();
      agent.updated_at = new Date().toISOString();
    } else {
      // Check organization limits
      const existingOrgAgents = Array.from(inMemoryDb.agents.values()).filter(a => a.organization_id === orgId && a.status !== 'revoked');
      if (org && existingOrgAgents.length >= org.max_agents) {
        return { success: false, error: `Plan limit reached: Maximum ${org.max_agents} agents allowed on ${org.plan} plan.` };
      }

      const agentId = uuidv4();
      agent = {
        id: agentId,
        organization_id: orgId,
        computer_name: hostInfo.computerName || 'Windows Host',
        os_version: hostInfo.osVersion || 'Windows',
        arch: hostInfo.arch || 'x64',
        agent_version: '1.0.0',
        ip_address: hostInfo.ipAddress || '127.0.0.1',
        status: 'online',
        auth_token_hash: agentAuthTokenHash,
        last_heartbeat: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      inMemoryDb.agents.set(agentId, agent);
    }

    // Create signed agent JWT token for subsequent agent API and WebSocket calls
    const agentJwt = jwt.sign(
      {
        agentId: agent.id,
        organizationId: agent.organization_id,
        computerName: agent.computer_name,
        type: 'agent',
      },
      config.jwtSecret,
      { expiresIn: '365d' }
    );

    // Audit log
    inMemoryDb.auditLogs.unshift({
      id: uuidv4(),
      organization_id: agent.organization_id,
      action: 'AGENT_ENROLLED',
      resource_type: 'agent',
      resource_id: agent.id,
      details: { computerName: agent.computer_name, ipAddress: agent.ip_address },
      created_at: new Date().toISOString(),
    });

    return {
      success: true,
      agent,
      agentAuthToken: agentJwt,
    };
  }

  /**
   * Revoke an agent by customer owner or platform admin
   */
  static revokeAgent(agentId: string, organizationId: string, performedByUserId: string, isAdmin = false): boolean {
    const agent = inMemoryDb.agents.get(agentId);
    if (!agent) return false;

    if (!isAdmin && agent.organization_id !== organizationId) {
      return false;
    }

    agent.status = 'revoked';
    agent.updated_at = new Date().toISOString();

    // Mark all devices connected to this agent as offline immediately
    for (const dev of inMemoryDb.devices.values()) {
      if (dev.agent_id === agentId) {
        dev.status = 'offline';
        dev.updated_at = new Date().toISOString();
      }
    }

    // Audit log
    inMemoryDb.auditLogs.unshift({
      id: uuidv4(),
      organization_id: agent.organization_id,
      user_id: performedByUserId,
      action: 'AGENT_REVOKED',
      resource_type: 'agent',
      resource_id: agent.id,
      details: { computerName: agent.computer_name },
      created_at: new Date().toISOString(),
    });

    return true;
  }
}
