import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { SubscriptionService } from '../services/subscriptionService';
import { inMemoryDb } from '../database/supabaseClient';

const router = Router();

// GET /api/subscription/status - Get current organization subscription status & plan limits
router.get('/status', authenticate, (req: Request, res: Response) => {
  const user = req.user!;
  const status = SubscriptionService.getStatus(user.organizationId);
  return res.json(status);
});

// POST /api/subscription/accept-terms - Customer accepts subscription terms & conditions
router.post('/accept-terms', authenticate, (req: Request, res: Response) => {
  const user = req.user!;
  if (user.system_role !== 'customer' && user.system_role !== 'admin') {
    return res.status(403).json({ error: 'Only account owners can accept subscription terms.' });
  }

  const success = SubscriptionService.acceptTerms(user.organizationId, user.id);
  if (!success) {
    return res.status(400).json({ error: 'Failed to accept subscription terms.' });
  }

  const updatedStatus = SubscriptionService.getStatus(user.organizationId);
  return res.json({
    success: true,
    message: 'Subscription terms successfully accepted.',
    status: updatedStatus,
  });
});

// POST /api/subscription/start-trial - Customer initiates 5-day free trial on Starter plan
router.post('/start-trial', authenticate, (req: Request, res: Response) => {
  const user = req.user!;
  if (user.system_role !== 'customer' && user.system_role !== 'admin') {
    return res.status(403).json({ error: 'Only account owners can start trial.' });
  }

  const result = SubscriptionService.startTrial(user.organizationId, user.id);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  const updatedStatus = SubscriptionService.getStatus(user.organizationId);
  return res.json({
    success: true,
    message: '5-Day Starter Trial activated successfully! Device streaming is now active.',
    status: updatedStatus,
  });
});

// POST /api/subscription/initialize-paystack - Prepare Paystack payment parameters
router.post('/initialize-paystack', authenticate, (req: Request, res: Response) => {
  const user = req.user!;
  const { plan } = req.body;

  if (plan !== 'starter' && plan !== 'enterprise') {
    return res.status(400).json({ error: 'Invalid plan. Choose starter or enterprise.' });
  }

  const paymentData = SubscriptionService.initializePayment(user.organizationId, user.email, plan);
  return res.json(paymentData);
});

// POST /api/subscription/verify-paystack - Verify completed Paystack payment and unlock streams
router.post('/verify-paystack', authenticate, async (req: Request, res: Response) => {
  const user = req.user!;
  const { reference, plan } = req.body;

  if (!reference) {
    return res.status(400).json({ error: 'Transaction reference is required.' });
  }

  if (plan !== 'starter' && plan !== 'enterprise') {
    return res.status(400).json({ error: 'Invalid plan specified for verification.' });
  }

  const result = await SubscriptionService.verifyPaystackPayment(
    user.organizationId,
    user.id,
    reference,
    plan
  );

  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  const updatedStatus = SubscriptionService.getStatus(user.organizationId);
  return res.json({
    success: true,
    message: `Payment confirmed! ${plan === 'starter' ? 'Starter' : 'Enterprise'} subscription is active. All device streams are unlocked.`,
    status: updatedStatus,
  });
});

// POST /api/subscription/paystack-webhook - Webhook listener for Paystack charge events
router.post('/paystack-webhook', async (req: Request, res: Response) => {
  const event = req.body;
  if (event && event.event === 'charge.success') {
    const data = event.data;
    const reference = data.reference;
    // Extract metadata
    const orgId = data.metadata?.organization_id;
    const plan = data.metadata?.plan || (data.amount >= 10000 ? 'enterprise' : 'starter');

    if (orgId && reference) {
      await SubscriptionService.verifyPaystackPayment(orgId, 'system_webhook', reference, plan);
    }
  }

  return res.status(200).send('OK');
});

export default router;
