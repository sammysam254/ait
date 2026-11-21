import { Router, Request, Response } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { inMemoryDb } from '../database/supabaseClient';

const router = Router();

// Protect all admin routes with strict Super Admin email and role verification
router.use(authenticate, (req: Request, res: Response, next) => {
  const user = req.user;
  if (!user || user.email.toLowerCase().trim() !== 'sammyseth260@gmail.com' || user.system_role !== 'admin') {
    return res.status(403).json({ error: 'Access denied: Platform Super Admin clearance required.' });
  }
  next();
});

// GET /api/admin/overview - Platform dashboard stats
router.get('/overview', (req: Request, res: Response) => {
  const totalCustomers = Array.from(inMemoryDb.profiles.values()).filter(p => p.system_role === 'customer').length;
  const totalOrganizations = inMemoryDb.organizations.size;
  const totalAgents = inMemoryDb.agents.size;
  const onlineAgents = Array.from(inMemoryDb.agents.values()).filter(a => a.status === 'online').length;
  
  const allDevices = Array.from(inMemoryDb.devices.values());
  const totalDevices = allDevices.length;
  const onlineDevices = allDevices.filter(d => d.status === 'online' || d.status === 'streaming').length;
  const streamingDevices = allDevices.filter(d => d.status === 'streaming').length;
  const offlineDevices = allDevices.filter(d => d.status === 'offline').length;

  const totalShares = inMemoryDb.deviceShares.size;
  const activeShares = Array.from(inMemoryDb.deviceShares.values()).filter(s => !s.is_revoked).length;

  return res.json({
    metrics: {
      totalCustomers,
      totalOrganizations,
      totalAgents,
      onlineAgents,
      totalDevices,
      onlineDevices,
      streamingDevices,
      offlineDevices,
      totalShares,
      activeShares,
    },
    systemHealth: {
      api: 'healthy',
      database: 'connected',
      websocket: 'operational',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    },
  });
});

// GET /api/admin/customers - List all customers and their device counts
router.get('/customers', (req: Request, res: Response) => {
  const customers = Array.from(inMemoryDb.organizations.values()).map(org => {
    const owner = inMemoryDb.profiles.get(org.owner_id);
    const orgAgents = Array.from(inMemoryDb.agents.values()).filter(a => a.organization_id === org.id);
    const orgDevices = Array.from(inMemoryDb.devices.values()).filter(d => d.organization_id === org.id);
    const orgShares = Array.from(inMemoryDb.deviceShares.values()).filter(s => s.organization_id === org.id);
    const assignedUsers = Array.from(inMemoryDb.assignedUsers.values()).filter(u => u.organization_id === org.id);

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      ownerEmail: owner?.email || 'unknown',
      ownerName: owner?.full_name || 'unknown',
      plan: org.plan,
      maxDevices: org.max_devices,
      maxAgents: org.max_agents,
      deviceCount: orgDevices.length,
      agentCount: orgAgents.length,
      activeSharesCount: orgShares.filter(s => !s.is_revoked).length,
      assignedUsersCount: assignedUsers.length,
      createdAt: org.created_at,
    };
  });

  return res.json({ customers });
});

// POST /api/admin/set-subscription - Super Admin manually activates, upgrades, or sets Custom Plan
router.post('/set-subscription', (req: Request, res: Response) => {
  const adminUser = req.user!;
  const { organizationId, plan, subscriptionStatus, maxDevices, maxAgents, priceUsd, durationDays } = req.body;

  if (!organizationId) {
    return res.status(400).json({ error: 'organizationId is required.' });
  }

  const { SubscriptionService } = require('../services/subscriptionService');
  const result = SubscriptionService.adminSetSubscription(adminUser.id, organizationId, {
    plan: plan || 'custom',
    subscriptionStatus: subscriptionStatus || 'active',
    maxDevices: maxDevices ? parseInt(maxDevices, 10) : undefined,
    maxAgents: maxAgents ? parseInt(maxAgents, 10) : undefined,
    priceUsd: priceUsd ? parseFloat(priceUsd) : undefined,
    durationDays: durationDays ? parseInt(durationDays, 10) : 30,
  });

  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  return res.json({
    success: true,
    organization: result.organization,
    message: `Subscription successfully updated for organization.`,
  });
});

// GET /api/admin/audit-logs - Global platform audit trail
router.get('/audit-logs', (req: Request, res: Response) => {
  const logs = inMemoryDb.auditLogs.slice(0, 100);
  return res.json({ logs });
});

export default router;
