import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { EnrollmentService } from '../services/enrollmentService';
import { inMemoryDb } from '../database/supabaseClient';

const router = Router();

// GET /api/agents - List registered Windows agents for current customer
router.get('/', authenticate, (req: Request, res: Response) => {
  const user = req.user!;
  const agents = Array.from(inMemoryDb.agents.values())
    .filter(a => user.system_role === 'admin' ? true : a.organization_id === user.organizationId)
    .map(a => {
      const deviceCount = Array.from(inMemoryDb.devices.values())
        .filter(d => d.agent_id === a.id).length;
      return {
        ...a,
        deviceCount,
      };
    });

  return res.json({ agents });
});

// POST /api/agents/:id/heartbeat - Agent periodic heartbeat
router.post('/:id/heartbeat', (req: Request, res: Response) => {
  const { id } = req.params;
  const agent = inMemoryDb.agents.get(id);

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found.' });
  }

  if (agent.status === 'revoked') {
    return res.status(403).json({ error: 'Agent has been revoked.' });
  }

  agent.status = 'online';
  agent.last_heartbeat = new Date().toISOString();
  agent.updated_at = new Date().toISOString();

  return res.json({ success: true, timestamp: agent.last_heartbeat });
});

// POST /api/agents/:id/revoke - Revoke a Windows agent
router.post('/:id/revoke', authenticate, (req: Request, res: Response) => {
  const user = req.user!;
  const { id } = req.params;

  const success = EnrollmentService.revokeAgent(
    id,
    user.organizationId,
    user.id,
    user.system_role === 'admin'
  );

  if (!success) {
    return res.status(404).json({ error: 'Agent not found or access denied.' });
  }

  return res.json({ success: true, message: 'Agent and associated devices successfully revoked.' });
});

export default router;
