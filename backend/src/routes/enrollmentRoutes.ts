import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { authenticate } from '../middleware/auth';
import { ScriptGeneratorService } from '../services/scriptGeneratorService';
import { EnrollmentService } from '../services/enrollmentService';
import { inMemoryDb } from '../database/supabaseClient';

const router = Router();

// GET /api/enrollment/download-script - Dynamic download of personalized setup.bat
router.get('/download-script', authenticate, (req: Request, res: Response) => {
  const user = req.user!;
  
  if (user.system_role !== 'customer' && user.system_role !== 'admin') {
    return res.status(403).json({ error: 'Only account owners or admins can download setup scripts.' });
  }

  const { filename, content } = ScriptGeneratorService.generateCustomerSetupScript(
    user.organizationId,
    user.id,
    user.email
  );

  res.setHeader('Content-Type', 'application/x-bat; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(content);
});

// GET /api/enrollment/script-info - View current script and enrollment token status in dashboard
router.get('/script-info', authenticate, (req: Request, res: Response) => {
  const user = req.user!;

  const tokens = Array.from(inMemoryDb.enrollmentTokens.values())
    .filter(t => t.organization_id === user.organizationId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const agents = Array.from(inMemoryDb.agents.values())
    .filter(a => a.organization_id === user.organizationId);

  return res.json({
    latestToken: tokens[0] || null,
    totalTokensGenerated: tokens.length,
    registeredAgentsCount: agents.length,
    agents: agents.map(a => ({
      id: a.id,
      computerName: a.computer_name,
      osVersion: a.os_version,
      status: a.status,
      lastHeartbeat: a.last_heartbeat,
      createdAt: a.created_at,
    })),
  });
});

// POST /api/enrollment/generate-new-token - Manually regenerate setup token
router.post('/generate-new-token', authenticate, (req: Request, res: Response) => {
  const user = req.user!;
  const result = EnrollmentService.generateEnrollmentToken(
    user.organizationId,
    user.id,
    req.body.tokenName || 'Dashboard Generated Token'
  );

  return res.json({
    success: true,
    token: result.token,
    expiresAt: result.expiresAt,
  });
});

// POST /api/enrollment/enroll - Called by setup.bat on customer's Windows machine
router.post('/enroll', (req: Request, res: Response) => {
  const { token, computerName, osVersion, arch, ipAddress } = req.body;

  if (!token) {
    return res.status(400).json({ success: false, error: 'Enrollment token is required.' });
  }

  const clientIp = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.socket.remoteAddress || ipAddress;

  const result = EnrollmentService.enrollAgent(token, {
    computerName: computerName || 'Windows Host',
    osVersion,
    arch,
    ipAddress: clientIp,
  });

  if (!result.success) {
    return res.status(400).json(result);
  }

  return res.json(result);
});

// GET /api/enrollment/download-scrcpy - Serves the official scrcpy 3.3.4 distribution
router.get('/download-scrcpy', (req: Request, res: Response) => {
  // Check location of scrcpy zip
  const candidates = [
    path.resolve(__dirname, '../../resources/scrcpy-win64-v3.3.4.zip'),
    path.resolve(process.cwd(), 'resources/scrcpy-win64-v3.3.4.zip'),
    path.resolve(process.cwd(), 'backend/resources/scrcpy-win64-v3.3.4.zip'),
    path.resolve(process.cwd(), '../windows-agent/resources/scrcpy-win64-v3.3.4.zip'),
    path.resolve(process.cwd(), 'windows-agent/resources/scrcpy-win64-v3.3.4.zip'),
    'C:/Users/sammy/.gemini/antigravity/brain/7828cce4-df5c-4217-9f5d-5efaa0eaa40d/.user_uploaded/media_1795009201223_4e2dcd56.zip',
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="scrcpy-win64-v3.3.4.zip"');
      return fs.createReadStream(candidate).pipe(res);
    }
  }

  return res.status(404).json({ error: 'scrcpy zip bundle not found on server.' });
});

export default router;
