import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { inMemoryDb, Profile, Organization } from '../database/supabaseClient';
import { authenticate } from '../middleware/auth';

const router = Router();

// POST /api/auth/login
router.post('/login', (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  const cleanEmail = email.toLowerCase().trim();

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
  }

  if (!profile) {
    return res.status(401).json({ error: 'No account found with this email. Please register first.' });
  }

  // Find their primary organization
  let organizationId = '';
  for (const org of inMemoryDb.organizations.values()) {
    if (org.owner_id === profile.id) {
      organizationId = org.id;
      break;
    }
  }

  if (!organizationId) {
    for (const au of inMemoryDb.assignedUsers.values()) {
      if (au.user_id === profile.id) {
        organizationId = au.organization_id;
        break;
      }
    }
  }

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
    },
  });
});

// POST /api/auth/register
router.post('/register', (req: Request, res: Response) => {
  const { email, fullName, companyName } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  const cleanEmail = email.toLowerCase().trim();
  const existing = Array.from(inMemoryDb.profiles.values()).find(
    p => p.email.toLowerCase() === cleanEmail
  );

  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
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
    },
  });
});

// GET /api/auth/me
router.get('/me', authenticate, (req: Request, res: Response) => {
  const user = req.user!;
  const profile = inMemoryDb.profiles.get(user.id);
  const organization = inMemoryDb.organizations.get(user.organizationId);

  return res.json({
    user: {
      id: user.id,
      email: user.email,
      fullName: profile?.full_name || '',
      role: user.system_role,
      organizationId: user.organizationId,
      organizationName: organization?.name || 'Cloud Device Farm',
      plan: organization?.plan || 'starter',
    },
  });
});

export default router;
