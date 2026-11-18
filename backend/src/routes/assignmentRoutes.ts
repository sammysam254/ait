import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { AssignmentService } from '../services/assignmentService';

const router = Router();

// GET /api/assignments/users - List subordinate users
router.get('/users', authenticate, (req: Request, res: Response) => {
  const user = req.user!;
  if (user.system_role !== 'customer' && user.system_role !== 'admin') {
    return res.status(403).json({ error: 'Only owners or admins can view assigned users list.' });
  }

  const users = AssignmentService.listAssignedUsers(user.organizationId);
  return res.json({ users });
});

// POST /api/assignments/invite - Invite subordinate user
router.post('/invite', authenticate, (req: Request, res: Response) => {
  const user = req.user!;
  const { email, fullName } = req.body;

  if (user.system_role !== 'customer' && user.system_role !== 'admin') {
    return res.status(403).json({ error: 'Only account owners can invite subordinate users.' });
  }

  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  const result = AssignmentService.inviteSubordinateUser(user.organizationId, user.id, email, fullName);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  return res.json({ success: true, user: result.user });
});

// POST /api/assignments/assign - Assign device to subordinate user
router.post('/assign', authenticate, (req: Request, res: Response) => {
  const user = req.user!;
  const { deviceId, assignedUserId, canView, canControl, canShare } = req.body;

  if (user.system_role !== 'customer' && user.system_role !== 'admin') {
    return res.status(403).json({ error: 'Only account owners can assign devices.' });
  }

  if (!deviceId || !assignedUserId) {
    return res.status(400).json({ error: 'deviceId and assignedUserId are required.' });
  }

  const result = AssignmentService.assignDevice(
    user.organizationId,
    deviceId,
    assignedUserId,
    user.id,
    { can_view: canView, can_control: canControl, can_share: canShare }
  );

  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  return res.json({ success: true, assignment: result.assignment });
});

// POST /api/assignments/revoke - Revoke device assignment
router.post('/revoke', authenticate, (req: Request, res: Response) => {
  const user = req.user!;
  const { deviceId, assignedUserId } = req.body;

  if (user.system_role !== 'customer' && user.system_role !== 'admin') {
    return res.status(403).json({ error: 'Only account owners can revoke device assignments.' });
  }

  const success = AssignmentService.revokeDeviceAssignment(user.organizationId, deviceId, assignedUserId, user.id);
  if (!success) {
    return res.status(404).json({ error: 'Assignment not found or unauthorized.' });
  }

  return res.json({ success: true, message: 'Device assignment successfully revoked.' });
});

// GET /api/assignments/device-credentials/:deviceId - Securely copy active URL & PIN for an assigned device
router.get('/device-credentials/:deviceId', authenticate, async (req: Request, res: Response) => {
  const user = req.user!;
  const { deviceId } = req.params;

  const credentials = await AssignmentService.getDeviceAccessCredentials(
    deviceId,
    user.organizationId,
    user.id,
    user.system_role
  );

  if (!credentials) {
    return res.status(403).json({ error: 'Access denied or device is not assigned to your account.' });
  }

  return res.json(credentials);
});

export default router;
