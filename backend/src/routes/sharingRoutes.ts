import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { SharingService } from '../services/sharingService';
import { DeviceService } from '../services/deviceService';

const router = Router();

// GET /api/sharing/device/:deviceId - Get active share info for device (Owner/Admin)
router.get('/device/:deviceId', authenticate, (req: Request, res: Response) => {
  const user = req.user!;
  const { deviceId } = req.params;

  const access = DeviceService.getDeviceById(deviceId, user);
  if (access.status !== 200) {
    return res.status(access.status).json({ error: access.error });
  }

  const share = SharingService.getShareForDevice(deviceId, access.device!.organization_id);

  return res.json({
    share: share || null,
  });
});

// POST /api/sharing/device/:deviceId - Create or renew share link
router.post('/device/:deviceId', authenticate, async (req: Request, res: Response) => {
  const user = req.user!;
  const { deviceId } = req.params;
  const { allowControl, expirationHours, maxUses, customPin } = req.body;

  const access = DeviceService.getDeviceById(deviceId, user);
  if (access.status !== 200) {
    return res.status(access.status).json({ error: access.error });
  }

  if (user.system_role === 'assigned_user' && !access.permissions?.can_share) {
    return res.status(403).json({ error: 'You do not have permission to share this device.' });
  }

  try {
    const result = await SharingService.createShare(
      deviceId,
      access.device!.organization_id,
      user.id,
      { allowControl, expirationHours, maxUses, customPin }
    );

    return res.json({
      success: true,
      share: result.share,
      pin: result.plainPin,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to create share.' });
  }
});

// POST /api/sharing/:shareId/rotate-pin - Rotate PIN
router.post('/:shareId/rotate-pin', authenticate, async (req: Request, res: Response) => {
  const user = req.user!;
  const { shareId } = req.params;

  const result = await SharingService.rotatePin(shareId, user.organizationId, user.id);
  if (!result) {
    return res.status(404).json({ error: 'Share not found or unauthorized.' });
  }

  return res.json({
    success: true,
    share: result.share,
    newPin: result.newPin,
  });
});

// POST /api/sharing/:shareId/rotate-token - Rotate share URL token
router.post('/:shareId/rotate-token', authenticate, (req: Request, res: Response) => {
  const user = req.user!;
  const { shareId } = req.params;

  const share = SharingService.rotateToken(shareId, user.organizationId, user.id);
  if (!share) {
    return res.status(404).json({ error: 'Share not found or unauthorized.' });
  }

  return res.json({
    success: true,
    share,
  });
});

// POST /api/sharing/:shareId/revoke - Revoke share link
router.post('/:shareId/revoke', authenticate, (req: Request, res: Response) => {
  const user = req.user!;
  const { shareId } = req.params;

  const success = SharingService.revokeShare(shareId, user.organizationId, user.id);
  if (!success) {
    return res.status(404).json({ error: 'Share not found or unauthorized.' });
  }

  return res.json({
    success: true,
    message: 'Device share link successfully revoked.',
  });
});

// ----------------------------------------------------------------------------
// PUBLIC SHARE VIEWER ENDPOINTS (No user authentication required)
// ----------------------------------------------------------------------------

// GET /api/sharing/public/:token - Inspect public share
router.get('/public/:token', (req: Request, res: Response) => {
  const { token } = req.params;
  const result = SharingService.inspectShareToken(token);

  if (!result.valid) {
    return res.status(403).json(result);
  }

  return res.json(result);
});

// POST /api/sharing/public/:token/verify-pin - Verify PIN and gain session token
router.post('/public/:token/verify-pin', async (req: Request, res: Response) => {
  const { token } = req.params;
  const { pin } = req.body;

  if (!pin) {
    return res.status(400).json({ error: 'PIN is required.' });
  }

  const clientIp = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

  const result = await SharingService.verifyPinAndAuthorize(token, pin.toString().trim(), clientIp);

  if (!result.success) {
    return res.status(401).json({ error: result.error });
  }

  return res.json({
    success: true,
    sessionToken: result.sessionToken,
    deviceId: result.deviceId,
    allowControl: result.allowControl,
  });
});

export default router;
