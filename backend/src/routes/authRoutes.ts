import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { inMemoryDb, Profile, Organization } from '../database/supabaseClient';
import { authenticate } from '../middleware/auth';
import { resolveOrgFromHost } from '../services/domainService';

const router = Router();

// POST /api/auth/login
router.post('/login', (req: Request, res: Response) => {
  const { email, password, host } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  const cleanEmail = email.toLowerCase().trim();

  // Resolve custom domain organization if visiting via a custom domain
  const rawHost = (host as string) || (req.headers['x-vertex-domain'] as string) || (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
  const cleanHost = rawHost.split(':')[0].toLowerCase().trim();
  const domainOrgId = cleanHost ? resolveOrgFromHost(cleanHost) : null;

  // Block login attempts on removed or inaccessible subdomains/domains
  const isDefaultSystemHost = (
    !cleanHost ||
    cleanHost === 'localhost' ||
    cleanHost === '127.0.0.1' ||
    cleanHost === 'vertext.online' ||
    cleanHost === 'www.vertext.online' ||
    cleanHost === 'api.vertext.online' ||
    cleanHost === 'app.vertext.online' ||
    cleanHost === 'vertextstreams.netlify.app'
  );

  if (!isDefaultSystemHost && !domainOrgId) {
    return res.status(404).json({
      error: `Access Denied: The portal domain (${cleanHost}) has been deleted or is not active.`,
    });
  }

  // Look up user profile
  let profile = Array.from(inMemoryDb.profiles.values()).find(
    p => p.email.toLowerCase() === cleanEmail
  );

  // Auto-provision Super Admin if sammyseth260@gmail.com logs in
  if (!profile && cleanEmail === 'sammyseth260@gmail.com') {
    const adminId = uuidv4();
    const adminOrgId = uuidv4();
    profile = {
      id: adminId,
      email: cleanEmail,
      full_name: 'Sammy Seth (Platform Super Admin)',
      system_role: 'admin',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    inMemoryDb.profiles.set(adminId, profile);
    inMemoryDb.organizations.set(adminOrgId, {
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
    inMemoryDb.save();
  }

  if (!profile) {
    return res.status(401).json({ error: 'No account found with this email. Please register or accept your team invitation.' });
  }

  // =========================================================================
  // DOMAIN-LEVEL MULTI-TENANT ACCESS CONTROL
  // Workers and clients can ONLY sign in through their assigned domain/organization.
  // =========================================================================
  if (domainOrgId) {
    const domainOrg = inMemoryDb.organizations.get(domainOrgId);
    const isSuperAdmin = profile.system_role === 'admin' || cleanEmail === 'sammyseth260@gmail.com';

    if (!isSuperAdmin) {
      const isOwnerOfDomainOrg = domainOrg && domainOrg.owner_id === profile.id;
      const isWorkerInDomainOrg = Array.from(inMemoryDb.assignedUsers.values()).some(
        au => au.organization_id === domainOrgId && (au.user_id === profile!.id || au.email.toLowerCase() === cleanEmail)
      );

      if (!isOwnerOfDomainOrg && !isWorkerInDomainOrg) {
        return res.status(403).json({
          error: `Access Denied: Your account does not belong to ${domainOrg?.name || 'this organization'}. Workers and clients can only sign in through their assigned organization portal.`,
        });
      }
    }
  }

  // Find their organization
  let organizationId = domainOrgId || '';

  // 1. Check if assigned subordinate worker or pre-invited
  const assignedUser = Array.from(inMemoryDb.assignedUsers.values()).find(
    au => (au.user_id === profile!.id || au.email.toLowerCase() === cleanEmail || (au.id && au.id === profile!.id))
  );

  if (assignedUser) {
    assignedUser.status = 'active';
    assignedUser.user_id = profile.id;
    organizationId = assignedUser.organization_id;
    if (profile.system_role !== 'admin' && profile.system_role !== 'customer') {
      profile.system_role = 'assigned_user';
    }
    // Relink device assignments to profile.id
    for (const da of inMemoryDb.deviceAssignments.values()) {
      if (da.organization_id === assignedUser.organization_id &&
         (da.assigned_user_id.toLowerCase() === cleanEmail || da.assigned_user_id === assignedUser.id)) {
        da.assigned_user_id = profile.id;
      }
    }
  }

  // 2. Check if primary customer / organization owner
  if (!organizationId) {
    for (const org of inMemoryDb.organizations.values()) {
      if (org.owner_id === profile.id) {
        organizationId = org.id;
        break;
      }
    }
  }

  // 3. Fallback check in assignedUsers
  if (!organizationId) {
    for (const au of inMemoryDb.assignedUsers.values()) {
      if (au.user_id === profile.id || au.email.toLowerCase() === cleanEmail) {
        organizationId = au.organization_id;
        au.status = 'active';
        au.user_id = profile.id;
        profile.system_role = 'assigned_user';
        break;
      }
    }
  }

  const organization = inMemoryDb.organizations.get(organizationId);

  const token = jwt.sign(
    {
      id: profile.id,
      email: profile.email,
      system_role: profile.system_role,
      organizationId,
    },
    config.jwtSecret,
    { expiresIn: '7d' }
  );

  return res.json({
    token,
    user: {
      id: profile.id,
      email: profile.email,
      fullName: profile.full_name,
      role: profile.system_role,
      organizationId,
      organizationName: organization?.name || 'Cloud Device Farm',
      plan: organization?.plan || 'starter',
    },
  });
});

// POST /api/auth/register
router.post('/register', (req: Request, res: Response) => {
  const { email, password, fullName, companyName, inviteToken, host } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  const cleanEmail = email.toLowerCase().trim();

  // Resolve custom domain organization if visiting via a custom domain
  const rawHost = (host as string) || (req.headers['x-vertex-domain'] as string) || (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
  const cleanHost = rawHost.split(':')[0].toLowerCase().trim();
  const domainOrgId = cleanHost ? resolveOrgFromHost(cleanHost) : null;

  // Block login attempts on removed or inaccessible subdomains/domains
  const isDefaultSystemHost = (
    !cleanHost ||
    cleanHost === 'localhost' ||
    cleanHost === '127.0.0.1' ||
    cleanHost === 'vertext.online' ||
    cleanHost === 'www.vertext.online' ||
    cleanHost === 'api.vertext.online' ||
    cleanHost === 'app.vertext.online' ||
    cleanHost === 'vertextstreams.netlify.app'
  );

  if (!isDefaultSystemHost && !domainOrgId) {
    return res.status(404).json({
      error: `Access Denied: The portal domain (${cleanHost}) has been deleted or is not active.`,
    });
  }

  // On custom branded domains, public registration without invite is restricted
  if (domainOrgId && !inviteToken) {
    const domainOrg = inMemoryDb.organizations.get(domainOrgId);
    return res.status(403).json({
      error: `Registration on ${domainOrg?.name || 'this portal'} is by invitation only. Please contact your administrator for an invite link.`,
    });
  }

  // =========================================================================
  // SUBORDINATE WORKER INVITATION FLOW
  // =========================================================================
  if (inviteToken) {
    const invite = Array.from(inMemoryDb.invitations.values()).find(
      inv => inv.token === inviteToken
    );

    if (!invite) {
      return res.status(400).json({ error: 'Invalid or expired invitation link. Please request a new invite from your team owner.' });
    }

    if (domainOrgId && invite.organization_id !== domainOrgId) {
      return res.status(400).json({
        error: 'This invitation was issued for another organization. Please access the invitation from the appropriate organization portal.',
      });
    }

    if (invite.status === 'expired' || new Date(invite.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'This invitation has expired. Please ask the account owner to invite you again.' });
    }

    if (invite.email.toLowerCase() !== cleanEmail) {
      return res.status(400).json({
        error: `This invitation was issued for ${invite.email}. Please register with that exact email address.`
      });
    }

    // Mark invitation accepted
    invite.status = 'accepted';

    // Find or create profile
    let profile = Array.from(inMemoryDb.profiles.values()).find(p => p.email.toLowerCase() === cleanEmail);
    const userId = profile ? profile.id : uuidv4();

    if (!profile) {
      profile = {
        id: userId,
        email: cleanEmail,
        full_name: fullName || invite.full_name || cleanEmail.split('@')[0],
        system_role: 'assigned_user',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      inMemoryDb.profiles.set(userId, profile);
    } else {
      profile.system_role = 'assigned_user';
      if (fullName) profile.full_name = fullName;
      profile.updated_at = new Date().toISOString();
    }

    // Link or activate in assignedUsers under inviter's organization
    let assignedUser = Array.from(inMemoryDb.assignedUsers.values()).find(
      au => au.organization_id === invite.organization_id && (au.email.toLowerCase() === cleanEmail || au.user_id === userId)
    );

    const oldUserId = assignedUser ? assignedUser.user_id : null;
    const oldAuId = assignedUser ? assignedUser.id : null;

    if (assignedUser) {
      assignedUser.user_id = userId;
      assignedUser.status = 'active';
    } else {
      assignedUser = {
        id: uuidv4(),
        organization_id: invite.organization_id,
        user_id: userId,
        email: cleanEmail,
        invited_by: invite.invited_by,
        status: 'active',
        created_at: new Date().toISOString(),
      };
      inMemoryDb.assignedUsers.set(assignedUser.id, assignedUser);
    }

    // Relink any device assignments that were keyed by email, oldUserId, or au.id to the new userId
    for (const da of inMemoryDb.deviceAssignments.values()) {
      if (da.organization_id === invite.organization_id &&
         (da.assigned_user_id.toLowerCase() === cleanEmail ||
          (oldUserId && da.assigned_user_id === oldUserId) ||
          (oldAuId && da.assigned_user_id === oldAuId) ||
          da.assigned_user_id === assignedUser.id)) {
        da.assigned_user_id = userId;
      }
    }

    const org = inMemoryDb.organizations.get(invite.organization_id);

    const token = jwt.sign(
      {
        id: profile.id,
        email: profile.email,
        system_role: 'assigned_user',
        organizationId: invite.organization_id,
      },
      config.jwtSecret,
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      token,
      user: {
        id: profile.id,
        email: profile.email,
        fullName: profile.full_name,
        role: 'assigned_user',
        organizationId: invite.organization_id,
        organizationName: org?.name || 'Cloud Device Farm',
        plan: org?.plan || 'starter',
      },
      message: 'Worker account created successfully. Routed to assigned team.',
    });
  }

  // =========================================================================
  // STANDARD CUSTOMER / AUTO-DETECTED INVITATION REGISTRATION FLOW
  // =========================================================================
  const existing = Array.from(inMemoryDb.profiles.values()).find(
    p => p.email.toLowerCase() === cleanEmail
  );

  // Check if an invitation or assignment exists for this email
  const preAssigned = Array.from(inMemoryDb.assignedUsers.values()).find(
    au => au.email.toLowerCase() === cleanEmail
  );
  const pendingInvite = Array.from(inMemoryDb.invitations.values()).find(
    inv => inv.email.toLowerCase() === cleanEmail && inv.status === 'pending'
  );

  if (preAssigned || pendingInvite) {
    const orgId = preAssigned ? preAssigned.organization_id : pendingInvite!.organization_id;
    const userId = existing ? existing.id : uuidv4();
    const oldUserId = preAssigned ? preAssigned.user_id : null;
    const oldAuId = preAssigned ? preAssigned.id : null;

    let profile = existing;
    if (!profile) {
      profile = {
        id: userId,
        email: cleanEmail,
        full_name: fullName || (pendingInvite ? pendingInvite.full_name : '') || cleanEmail.split('@')[0],
        system_role: 'assigned_user',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      inMemoryDb.profiles.set(userId, profile);
    } else {
      profile.system_role = 'assigned_user';
      if (fullName) profile.full_name = fullName;
      profile.updated_at = new Date().toISOString();
    }

    if (preAssigned) {
      preAssigned.user_id = userId;
      preAssigned.status = 'active';
    }
    if (pendingInvite) {
      pendingInvite.status = 'accepted';
    }

    // Relink any device assignments
    for (const da of inMemoryDb.deviceAssignments.values()) {
      if (da.organization_id === orgId &&
         (da.assigned_user_id.toLowerCase() === cleanEmail ||
          (oldUserId && da.assigned_user_id === oldUserId) ||
          (oldAuId && da.assigned_user_id === oldAuId) ||
          (preAssigned && da.assigned_user_id === preAssigned.id))) {
        da.assigned_user_id = userId;
      }
    }

    inMemoryDb.save();

    const org = inMemoryDb.organizations.get(orgId);
    const token = jwt.sign(
      {
        id: profile.id,
        email: profile.email,
        system_role: 'assigned_user',
        organizationId: orgId,
      },
      config.jwtSecret,
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      token,
      user: {
        id: profile.id,
        email: profile.email,
        fullName: profile.full_name,
        role: 'assigned_user',
        organizationId: orgId,
        organizationName: org?.name || 'Cloud Device Farm',
        plan: org?.plan || 'starter',
      },
      message: 'Worker account created successfully and routed to assigned team.',
    });
  }

  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
  }

  const isSuperAdmin = cleanEmail === 'sammyseth260@gmail.com';
  const role = isSuperAdmin ? 'admin' : 'customer';
  const plan = isSuperAdmin ? 'enterprise' : 'starter';

  const userId = uuidv4();
  const orgId = uuidv4();
  const userName = fullName || (isSuperAdmin ? 'Sammy Seth (Super Admin)' : cleanEmail.split('@')[0]);
  const orgName = companyName || `${userName}'s Devices`;
  const orgSlug = orgName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + userId.slice(0, 4);

  const profile: Profile = {
    id: userId,
    email: cleanEmail,
    full_name: userName,
    system_role: role,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const organization: Organization = {
    id: orgId,
    name: orgName,
    slug: orgSlug,
    owner_id: userId,
    plan: plan,
    max_devices: isSuperAdmin ? 1000 : 5,
    max_agents: isSuperAdmin ? 100 : 3,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  inMemoryDb.profiles.set(userId, profile);
  inMemoryDb.organizations.set(orgId, organization);
  inMemoryDb.save();

  const token = jwt.sign(
    {
      id: profile.id,
      email: profile.email,
      system_role: profile.system_role,
      organizationId: orgId,
    },
    config.jwtSecret,
    { expiresIn: '7d' }
  );

  return res.status(201).json({
    token,
    user: {
      id: profile.id,
      email: profile.email,
      fullName: profile.full_name,
      role: profile.system_role,
      organizationId: orgId,
      organizationName: orgName,
      plan: plan,
    },
  });
});

// GET /api/auth/me
router.get('/me', authenticate, (req: Request, res: Response) => {
  const user = req.user!;
  const profile = inMemoryDb.profiles.get(user.id);
  let organization = inMemoryDb.organizations.get(user.organizationId);

  // If organization not found by direct ID, check assignedUsers records
  if (!organization) {
    const au = Array.from(inMemoryDb.assignedUsers.values()).find(
      u => u.user_id === user.id || u.email.toLowerCase().trim() === user.email.toLowerCase().trim()
    );
    if (au) {
      organization = inMemoryDb.organizations.get(au.organization_id);
    }
  }

  return res.json({
    user: {
      id: user.id,
      email: user.email,
      fullName: profile?.full_name || user.email.split('@')[0],
      role: user.system_role,
      organizationId: organization ? organization.id : user.organizationId,
      organizationName: organization?.name || 'Cloud Device Farm',
      plan: organization?.plan || 'starter',
    },
  });
});

export default router;
