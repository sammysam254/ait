import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { DeviceService } from '../services/deviceService';
import { inMemoryDb } from '../database/supabaseClient';

const router = Router();

// GET /api/devices - List devices (enforces tenant and assignment boundaries)
router.get('/', authenticate, (req: Request, res: Response) => {
  const user = req.user!;
  const devices = DeviceService.listDevicesForUser(user);
  return res.json({ devices });
});

// GET /api/devices/:id - Get specific device details
router.get('/:id', authenticate, (req: Request, res: Response) => {
  const user = req.user!;
  const { id } = req.params;

  const result = DeviceService.getDeviceById(id, user);

  if (result.status !== 200) {
    return res.status(result.status).json({ error: result.error });
  }

  // Find agent info
  const agent = inMemoryDb.agents.get(result.device!.agent_id);

  return res.json({
    device: result.device,
    permissions: result.permissions,
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
