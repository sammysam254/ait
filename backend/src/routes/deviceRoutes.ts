import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { authenticate } from '../middleware/auth';
import { DeviceService } from '../services/deviceService';
import { inMemoryDb } from '../database/supabaseClient';
import { config } from '../config';

const router = Router();

// GET /api/devices - List devices (enforces tenant and assignment boundaries)
router.get('/', authenticate, (req: Request, res: Response) => {
  const user = req.user!;
  const devices = DeviceService.listDevicesForUser(user);
  return res.json({ devices });
});

// GET /api/devices/:id - Get specific device details & fresh stream connection token
router.get('/:id', authenticate, (req: Request, res: Response) => {
  const user = req.user!;
  const { id } = req.params;

  const result = DeviceService.getDeviceById(id, user);

  if (result.status !== 200) {
    return res.status(result.status).json({ error: result.error });
  }

  const activeDevice = result.device!;
  const realDeviceId = activeDevice.id;

  // Strict Subscription Gate: Verify active subscription or active trial for the device's organization
  const { SubscriptionService } = require('../services/subscriptionService');
  const subStatus = SubscriptionService.isSubscriptionActive(activeDevice.organization_id || user.organizationId);
  if (!subStatus.active && user.system_role !== 'admin') {
    return res.status(402).json({
      error: subStatus.reason || 'Subscription Expired - Streaming Suspended. Your monthly plan is due. Please renew your subscription to unblock live remote device streams.',
      subscriptionExpired: true,
      status: 402,
      dueDate: subStatus.dueDate,
    });
  }

  // Find agent info
  const agent = inMemoryDb.agents.get(activeDevice.agent_id);

  // Generate dedicated, fresh streaming token and WebSocket URL for client
  const streamToken = jwt.sign(
    {
      id: user.id,
      email: user.email,
      system_role: user.system_role,
      organizationId: user.organizationId,
      deviceId: realDeviceId,
      type: 'viewer',
    },
    config.jwtSecret,
    { expiresIn: '24h' }
  );

  let backendHost = 'api-streams.sam.co.ke';
  try {
    const parsed = new URL(config.backendUrl);
    backendHost = parsed.host;
  } catch (e) {}

  const streamWsUrl = `wss://${backendHost}/ws?token=${encodeURIComponent(streamToken)}&deviceId=${realDeviceId}`;

  return res.json({
    device: activeDevice,
    permissions: result.permissions,
    streamToken,
    streamWsUrl,
    agent: agent ? {
      computerName: agent.computer_name,
      osVersion: agent.os_version,
      status: agent.status,
    } : null,
  });
});

// POST /api/devices/sync - Agent reports discovered ADB devices
router.post('/sync', (req: Request, res: Response) => {
  const { agentId, organizationId, devices } = req.body;

  if (!agentId || !organizationId || !Array.isArray(devices)) {
    return res.status(400).json({ error: 'agentId, organizationId, and devices array are required.' });
  }

  let agent = inMemoryDb.agents.get(agentId);
  if (!agent) {
    // If container restarted, restore agent session into memory
    agent = {
      id: agentId,
      organization_id: organizationId,
      computer_name: 'Windows Host',
      os_version: 'Windows',
      arch: 'x64',
      agent_version: '1.0.0',
      ip_address: (req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1'),
      status: 'online',
      auth_token_hash: '',
      last_heartbeat: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    inMemoryDb.agents.set(agentId, agent);
  } else if (agent.status === 'revoked') {
    return res.status(403).json({ error: 'Agent has been revoked.' });
  }

  const synced = DeviceService.syncAgentDevices(agentId, organizationId, devices);

  return res.json({
    success: true,
    count: synced.length,
    devices: synced,
  });
});

// POST /api/devices/:id/status - Update device status
router.post('/:id/status', authenticate, (req: Request, res: Response) => {
  const user = req.user!;
  const { id } = req.params;
  const { status } = req.body;

  const check = DeviceService.getDeviceById(id, user);
  if (check.status !== 200) {
    return res.status(check.status).json({ error: check.error });
  }

  DeviceService.updateStatus(id, status);
  return res.json({ success: true, status });
});

export default router;
