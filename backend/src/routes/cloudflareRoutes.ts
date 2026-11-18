import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { CloudflareService } from '../services/cloudflareService';

const router = Router();

// GET /api/cloudflare/tunnels - List active Cloudflare tunnels for organization
router.get('/tunnels', authenticate, (req: Request, res: Response) => {
  const user = req.user!;
  const tunnels = CloudflareService.getTunnelsForOrg(user.organizationId);
  return res.json({ tunnels });
});

// POST /api/cloudflare/provision - Provision tunnel for an agent
router.post('/provision', authenticate, async (req: Request, res: Response) => {
  const user = req.user!;
  const { agentId, computerName } = req.body;

  if (!agentId || !computerName) {
    return res.status(400).json({ error: 'agentId and computerName are required.' });
  }

  const result = await CloudflareService.provisionAgentTunnel(
    user.organizationId,
    agentId,
    computerName
  );

  return res.json({
    success: true,
    tunnel: result,
  });
});

export default router;
