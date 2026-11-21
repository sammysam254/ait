import { inMemoryDb, Organization } from '../database/supabaseClient';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';

export interface PlanDefinition {
  id: 'starter' | 'enterprise' | 'custom';
  name: string;
  priceUsd: number;
  period: 'monthly';
  maxDevices: number;
  maxHosts: number;
  hasTrial: boolean;
  trialDays: number;
  description: string;
  features: string[];
}

export const SUBSCRIPTION_PLANS: Record<string, PlanDefinition> = {
  starter: {
    id: 'starter',
    name: 'Starter Plan',
    priceUsd: 80,
    period: 'monthly',
    maxDevices: 15,
    maxHosts: 2,
    hasTrial: true,
    trialDays: 5,
    description: 'Ideal for small teams and individual testers with up to 15 phones.',
    features: [
      'Up to 15 Connected Android Phones',
      '2 Windows Host Computers',
      'Low-latency 60 FPS H.264 Video Streaming',
      'Interactive Touch & Virtual Controls',
      'Real-time Stereo Audio Streaming',
      '5-Day Free Trial Option Available',
    ],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise Plan',
    priceUsd: 100,
    period: 'monthly',
    maxDevices: 30,
    maxHosts: 3,
    hasTrial: false,
    trialDays: 0,
    description: 'High-density testing rig supporting up to 30 active phones across 3 host rigs.',
    features: [
      'Up to 30 Connected Android Phones',
      '3 Windows Host Computers',
      'Low-latency 60 FPS H.264 Video Streaming',
      'Interactive Touch & Virtual Controls',
      'Subordinate Worker Assignments & PIN Rotation',
      'Audit Logs & Dedicated WebRTC Relays',
      'Priority Support',
    ],
  },
  custom: {
    id: 'custom',
    name: 'Custom Fleet Plan',
    priceUsd: 0, // Quote based
    period: 'monthly',
    maxDevices: 100,
    maxHosts: 10,
    hasTrial: false,
    trialDays: 0,
    description: 'Custom device racks, unlimited hosts, and dedicated cloud infrastructure.',
    features: [
      'Custom Android Fleet (30+ devices)',
      'Unlimited Windows Computer Hosts',
      'Custom Dedicated Streaming Gateway & TURN',
      'Direct WhatsApp & Call Support (+254706499848)',
      'Manually Subscribed & Managed by Super Admin',
    ],
  },
};

export const SUBSCRIPTION_TERMS = [
  {
    id: 1,
    title: 'Recurring Billing & Due Date Commitment',
    content:
      'Subscription fees are billed monthly starting on the exact date you accept these terms. Your account renewal will be due on this same calendar date every 30 days.',
  },
  {
    id: 2,
    title: 'Strict Service Suspension Upon Non-Payment',
    content:
      'If your subscription payment is not confirmed on or before the due date, all live device video streams and remote controls are immediately blocked by the server until full payment is completed.',
  },
  {
    id: 3,
    title: 'Device Fleet & Computer Host Concurrency Quotas',
    content:
      'Starter Plan permits a maximum of 15 connected Android devices across 2 Windows computer hosts. Enterprise Plan permits up to 30 devices across 3 Windows computer hosts. Connecting hardware beyond these quotas requires upgrading or obtaining a Custom Plan.',
  },
  {
    id: 4,
    title: 'Starter 5-Day Trial Rules',
    content:
      'Starter Plan users may choose a one-time 5-day trial. On the 5th day, the trial terminates automatically and the full $80 USD subscription fee is required to unlock device streams.',
  },
  {
    id: 5,
    title: 'Immediate Infrastructure Allocation & No Refunds',
    content:
      'Because low-latency WebRTC compute gateways and cloud resources are allocated immediately upon payment confirmation, all subscription charges are strictly non-refundable once the billing period commences.',
  },
];

export class SubscriptionService {
  /**
   * Calculate effective plan price for an organization (with custom overrides or +/- adjustments)
   */
  static getPlanPriceForOrg(org: Organization | undefined, plan: 'starter' | 'enterprise' | 'custom'): number {
    const defaultPrice = SUBSCRIPTION_PLANS[plan]?.priceUsd ?? (plan === 'starter' ? 80 : 100);
    if (!org) return defaultPrice;

    // Direct plan override if set
    if (org.custom_pricing && typeof org.custom_pricing[plan] === 'number') {
      return Math.max(0, org.custom_pricing[plan]!);
    }

    // General +/- adjustment in USD (e.g. -20 for discount or +10 for markup)
    if (typeof org.price_adjustment_usd === 'number' && org.price_adjustment_usd !== 0) {
      return Math.max(0, defaultPrice + org.price_adjustment_usd);
    }

    // Custom plan quote override
    if (plan === 'custom' && typeof org.custom_price_usd === 'number') {
      return org.custom_price_usd;
    }

    return defaultPrice;
  }

  /**
   * Helper to verify if an organization's subscription is currently active.
   * Auto-marks expired subscriptions in memory & saves.
   */
  static isSubscriptionActive(organizationId: string): {
    active: boolean;
    status: 'active' | 'trial_active' | 'expired' | 'past_due' | 'terms_required';
    reason?: string;
    dueDate?: string;
    plan?: string;
    termsAccepted: boolean;
  } {
    // Super Admin organization is always active
    if (organizationId === 'aaaa0000-0000-0000-0000-000000000001') {
      return { active: true, status: 'active', termsAccepted: true, plan: 'enterprise' };
    }

    const org = inMemoryDb.organizations.get(organizationId);
    if (!org) {
      return { active: false, status: 'expired', reason: 'Organization not found.', termsAccepted: false };
    }

    const owner = inMemoryDb.profiles.get(org.owner_id);
    if (owner?.email.toLowerCase().trim() === 'sammyseth260@gmail.com') {
      return { active: true, status: 'active', termsAccepted: true, plan: 'enterprise' };
    }

    // Check if terms have been accepted
    if (!org.terms_accepted) {
      return {
        active: false,
        status: 'terms_required',
        reason: 'Subscription terms must be accepted before device streaming can begin.',
        termsAccepted: false,
        plan: org.plan || 'starter',
      };
    }

    const now = Date.now();

    // Check trial
    if (org.subscription_status === 'trial_active') {
      const trialEnds = org.trial_ends_at ? new Date(org.trial_ends_at).getTime() : 0;
      if (now > trialEnds) {
        org.subscription_status = 'expired';
        org.updated_at = new Date().toISOString();
        inMemoryDb.save();
        return {
          active: false,
          status: 'expired',
          reason: 'Your 5-day trial period has ended. Please pay your subscription fee to resume live device streaming.',
          dueDate: org.trial_ends_at,
          termsAccepted: true,
          plan: org.plan,
        };
      }
      return {
        active: true,
        status: 'trial_active',
        dueDate: org.trial_ends_at,
        termsAccepted: true,
        plan: org.plan,
      };
    }

    // Check active paid subscription
    if (org.subscription_status === 'active') {
      const periodEnd = org.current_period_end ? new Date(org.current_period_end).getTime() : 0;
      if (now > periodEnd) {
        org.subscription_status = 'expired';
        org.updated_at = new Date().toISOString();
        inMemoryDb.save();
        return {
          active: false,
          status: 'expired',
          reason: 'Subscription Expired: Your monthly plan is due. Live streaming is suspended until renewal.',
          dueDate: org.current_period_end,
          termsAccepted: true,
          plan: org.plan,
        };
      }
      return {
        active: true,
        status: 'active',
        dueDate: org.current_period_end,
        termsAccepted: true,
        plan: org.plan,
      };
    }

    // Expired or inactive
    return {
      active: false,
      status: org.subscription_status || 'expired',
      reason: 'Subscription Expired - Streaming Suspended. Your monthly plan is due. Please renew your subscription to unblock live remote device streams.',
      dueDate: org.current_period_end || org.trial_ends_at,
      termsAccepted: !!org.terms_accepted,
      plan: org.plan || 'starter',
    };
  }

  /**
   * Get full subscription status for an organization (for customer & viewer dashboard)
   */
  static getStatus(organizationId: string) {
    const org = inMemoryDb.organizations.get(organizationId);
    const subCheck = this.isSubscriptionActive(organizationId);

    const now = Date.now();
    let daysRemaining = 0;
    if (subCheck.dueDate) {
      const due = new Date(subCheck.dueDate).getTime();
      daysRemaining = Math.max(0, Math.ceil((due - now) / (1000 * 3600 * 24)));
    }

    const starterPriceUsd = this.getPlanPriceForOrg(org, 'starter');
    const enterprisePriceUsd = this.getPlanPriceForOrg(org, 'enterprise');

    return {
      organizationId,
      organizationName: org?.name || 'My Organization',
      plan: org?.plan || 'starter',
      planDetails: SUBSCRIPTION_PLANS[org?.plan || 'starter'] || SUBSCRIPTION_PLANS.starter,
      status: subCheck.status,
      active: subCheck.active,
      reason: subCheck.reason,
      dueDate: subCheck.dueDate || null,
      daysRemaining,
      termsAccepted: !!org?.terms_accepted,
      termsAcceptedAt: org?.terms_accepted_at || null,
      maxDevices: org?.max_devices || 15,
      maxAgents: org?.max_agents || 2,
      lastPaymentReference: org?.last_payment_reference || null,
      lastPaymentAmount: org?.last_payment_amount || null,
      customPriceUsd: org?.custom_price_usd || null,
      customPricing: org?.custom_pricing || null,
      priceAdjustmentUsd: org?.price_adjustment_usd || 0,
      pricingNote: org?.pricing_note || null,
      starterPriceUsd,
      enterprisePriceUsd,
      contactPhone: '+254706499848',
      terms: SUBSCRIPTION_TERMS,
      plans: SUBSCRIPTION_PLANS,
      paystackPublicKey: config.paystack.publicKey,
    };
  }

  /**
   * Customer accepts subscription terms
   */
  static acceptTerms(organizationId: string, userId: string): boolean {
    const org = inMemoryDb.organizations.get(organizationId);
    if (!org) return false;

    org.terms_accepted = true;
    org.terms_accepted_at = new Date().toISOString();
    org.updated_at = new Date().toISOString();

    // Default to starter if no plan set
    if (!org.plan) {
      org.plan = 'starter';
      org.max_devices = 15;
      org.max_agents = 2;
    }

    inMemoryDb.auditLogs.unshift({
      id: uuidv4(),
      organization_id: organizationId,
      user_id: userId,
      action: 'SUBSCRIPTION_TERMS_ACCEPTED',
      resource_type: 'subscription',
      resource_id: organizationId,
      details: { termsAcceptedAt: org.terms_accepted_at },
      created_at: new Date().toISOString(),
    });

    inMemoryDb.save();
    return true;
  }

  /**
   * Customer starts 5-day free trial on Starter plan
   */
  static startTrial(organizationId: string, userId: string): { success: boolean; error?: string; organization?: Organization } {
    const org = inMemoryDb.organizations.get(organizationId);
    if (!org) return { success: false, error: 'Organization not found.' };

    if (org.trial_started_at) {
      return { success: false, error: 'Free trial has already been used for this account. Please pay the monthly subscription fee.' };
    }

    const now = new Date();
    const trialEnds = new Date(now.getTime() + 5 * 24 * 3600 * 1000); // 5 days

    org.plan = 'starter';
    org.max_devices = 15;
    org.max_agents = 2;
    org.subscription_status = 'trial_active';
    org.trial_started_at = now.toISOString();
    org.trial_ends_at = trialEnds.toISOString();
    org.current_period_start = now.toISOString();
    org.current_period_end = trialEnds.toISOString();
    org.terms_accepted = true;
    org.terms_accepted_at = org.terms_accepted_at || now.toISOString();
    org.updated_at = now.toISOString();

    inMemoryDb.auditLogs.unshift({
      id: uuidv4(),
      organization_id: organizationId,
      user_id: userId,
      action: 'STARTER_TRIAL_ACTIVATED',
      resource_type: 'subscription',
      resource_id: organizationId,
      details: { trialEndsAt: org.trial_ends_at },
      created_at: new Date().toISOString(),
    });

    inMemoryDb.save();
    return { success: true, organization: org };
  }

  /**
   * Initializes a Paystack in-app payment transaction reference
   */
  static initializePayment(
    organizationId: string,
    userEmail: string,
    plan: 'starter' | 'enterprise'
  ): { reference: string; amountCents: number; amountUsd: number; publicKey: string; email: string; plan: string } {
    const org = inMemoryDb.organizations.get(organizationId);
    const amountUsd = this.getPlanPriceForOrg(org, plan);
    const amountCents = Math.round(amountUsd * 100); // Paystack takes currency sub-units (e.g. 8000 for $80 USD)
    const reference = `VTX_${plan.toUpperCase()}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    return {
      reference,
      amountCents,
      amountUsd,
      publicKey: config.paystack.publicKey,
      email: userEmail,
      plan,
    };
  }

  /**
   * Verifies payment with Paystack API and activates 30-day subscription
   */
  static async verifyPaystackPayment(
    organizationId: string,
    userId: string,
    reference: string,
    expectedPlan: 'starter' | 'enterprise'
  ): Promise<{ success: boolean; organization?: Organization; error?: string }> {
    const org = inMemoryDb.organizations.get(organizationId);
    if (!org) {
      return { success: false, error: 'Organization not found.' };
    }

    try {
      // Query Paystack Transaction Verify API
      const verifyUrl = `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`;
      const response = await fetch(verifyUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${config.paystack.secretKey}`,
          'Content-Type': 'application/json',
        },
      });

      const json = await response.json() as any;

      if (!response.ok || !json.status || !json.data) {
        return {
          success: false,
          error: json.message || 'Payment verification failed with Paystack.',
        };
      }

      const txData = json.data;

      if (txData.status !== 'success') {
        return {
          success: false,
          error: `Payment is not completed. Current status: ${txData.status}`,
        };
      }

      // Check paid amount against effective organization plan price
      const expectedUsd = this.getPlanPriceForOrg(org, expectedPlan);
      const expectedCents = Math.round(expectedUsd * 100);

      // Activate or renew 30-day subscription
      const now = new Date();
      // If currently active and renewed early, add 30 days to existing period; otherwise start 30 days from now
      let newPeriodEnd = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
      if (org.subscription_status === 'active' && org.current_period_end) {
        const existingEnd = new Date(org.current_period_end).getTime();
        if (existingEnd > now.getTime()) {
          newPeriodEnd = new Date(existingEnd + 30 * 24 * 3600 * 1000);
        }
      }

      org.plan = expectedPlan;
      org.max_devices = expectedPlan === 'starter' ? 15 : 30;
      org.max_agents = expectedPlan === 'starter' ? 2 : 3;
      org.subscription_status = 'active';
      org.current_period_start = now.toISOString();
      org.current_period_end = newPeriodEnd.toISOString();
      org.terms_accepted = true;
      org.terms_accepted_at = org.terms_accepted_at || now.toISOString();
      org.last_payment_reference = reference;
      org.last_payment_amount = (txData.amount || expectedCents) / 100;
      org.updated_at = now.toISOString();

      inMemoryDb.auditLogs.unshift({
        id: uuidv4(),
        organization_id: organizationId,
        user_id: userId,
        action: 'PAYSTACK_PAYMENT_CONFIRMED',
        resource_type: 'subscription',
        resource_id: organizationId,
        details: {
          reference,
          plan: expectedPlan,
          amount: org.last_payment_amount,
          newPeriodEnd: org.current_period_end,
        },
        created_at: now.toISOString(),
      });

      inMemoryDb.save();
      console.log(`[SubscriptionService] Paystack payment confirmed for org ${org.name} (${expectedPlan}). Sub active until ${org.current_period_end}`);

      return { success: true, organization: org };
    } catch (err: any) {
      console.error('[SubscriptionService] Paystack verification error:', err);
      return { success: false, error: err.message || 'Payment verification request failed.' };
    }
  }

  /**
   * Super Admin manually sets or modifies customer subscription & custom pricing (add or minus USD)
   */
  static adminSetSubscription(
    adminUserId: string,
    organizationId: string,
    params: {
      plan?: 'starter' | 'enterprise' | 'custom';
      subscriptionStatus?: 'active' | 'trial_active' | 'expired';
      maxDevices?: number;
      maxAgents?: number;
      priceUsd?: number;
      durationDays?: number;
      customPricing?: { starter?: number; enterprise?: number; custom?: number };
      priceAdjustmentUsd?: number;
      pricingNote?: string;
    }
  ): { success: boolean; organization?: Organization; error?: string } {
    const org = inMemoryDb.organizations.get(organizationId);
    if (!org) return { success: false, error: 'Organization not found.' };

    const now = new Date();
    const durationDays = params.durationDays || 30;
    const periodEnd = new Date(now.getTime() + durationDays * 24 * 3600 * 1000);

    if (params.plan) org.plan = params.plan;
    if (params.subscriptionStatus) org.subscription_status = params.subscriptionStatus;
    if (params.maxDevices !== undefined) org.max_devices = params.maxDevices;
    if (params.maxAgents !== undefined) org.max_agents = params.maxAgents;
    if (params.subscriptionStatus === 'active') {
      org.current_period_start = now.toISOString();
      org.current_period_end = periodEnd.toISOString();
    }
    org.terms_accepted = true;
    org.terms_accepted_at = org.terms_accepted_at || now.toISOString();
    if (params.priceUsd !== undefined) org.custom_price_usd = params.priceUsd;
    if (params.customPricing !== undefined) org.custom_pricing = params.customPricing;
    if (params.priceAdjustmentUsd !== undefined) org.price_adjustment_usd = params.priceAdjustmentUsd;
    if (params.pricingNote !== undefined) org.pricing_note = params.pricingNote;
    org.updated_at = now.toISOString();

    inMemoryDb.auditLogs.unshift({
      id: uuidv4(),
      organization_id: organizationId,
      user_id: adminUserId,
      action: 'ADMIN_MANUALLY_SET_SUBSCRIPTION_AND_PRICING',
      resource_type: 'subscription',
      resource_id: organizationId,
      details: {
        plan: org.plan,
        status: org.subscription_status,
        maxDevices: org.max_devices,
        maxAgents: org.max_agents,
        customPricing: org.custom_pricing,
        priceAdjustmentUsd: org.price_adjustment_usd,
        pricingNote: org.pricing_note,
        periodEnd: org.current_period_end,
      },
      created_at: now.toISOString(),
    });

    inMemoryDb.save();
    return { success: true, organization: org };
  }
}
