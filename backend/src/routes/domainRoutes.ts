import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { inMemoryDb } from '../database/supabaseClient';
import crypto from 'crypto';
import {
  getDomainsForOrg,
  listCloudflareZones,
  findCloudflareZoneForDomain,
  connectCloudflareZoneDomain,
  createCloudflareZoneForTransfer,
  checkCloudflareZoneActivation,
  provisionSubdomain,
  addExternalDomain,
  verifyExternalDomain,
  removeDomain,
  resolveOrgFromHost,
} from '../services/domainService';

// ─── Pending-purchase registry ────────────────────────────────────────────────
// Maps a short state token → { organizationId, userId, domain, createdAt }
// Written when customer is redirected to Cloudflare Registrar.
// Consumed by either webhook (Cloudflare pushes event) or polling (customer
// clicks "I've purchased — activate now").
interface PendingPurchase {
  organizationId: string;
  userId: string;
  domain: string;
  createdAt: number; // Date.now()
}
const pendingPurchases = new Map<string, PendingPurchase>();

/** Purge entries older than 24 h so memory doesn't grow forever */
function cleanOldPending() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [k, v] of pendingPurchases) {
    if (v.createdAt < cutoff) pendingPurchases.delete(k);
  }
}
setInterval(cleanOldPending, 60 * 60 * 1000); // hourly

const router = Router();

// PUBLIC: GET /api/domains/resolve - Resolve tenant details from hostname (for custom domain branded login)
router.get('/resolve', (req: Request, res: Response) => {
  const hostParam = (req.query.host as string) || (req.headers['x-vertex-domain'] as string) || (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
  const cleanHost = hostParam.split(':')[0].toLowerCase().trim();

  if (!cleanHost) {
    return res.json({ matched: false, organization: null });
  }

  // System default domains
  if (
    cleanHost === 'localhost' ||
    cleanHost === '127.0.0.1' ||
    cleanHost === 'vertext.online' ||
    cleanHost === 'api.vertext.online'
  ) {
    return res.json({ matched: false, isDefaultHost: true, organization: null });
  }

  const orgId = resolveOrgFromHost(cleanHost);
  if (!orgId) {
    return res.json({ matched: false, domain: cleanHost, organization: null });
  }

  const org = inMemoryDb.organizations.get(orgId);
  if (!org) {
    return res.json({ matched: false, domain: cleanHost, organization: null });
  }

  return res.json({
    matched: true,
    domain: cleanHost,
    organization: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      plan: org.plan,
    },
  });
});

// GET /api/domains - List domains for user's organization
router.get('/', authenticate, (req: Request, res: Response) => {
  const user = req.user!;
  const domains = getDomainsForOrg(user.organizationId);
  return res.json({ domains });
});

// GET /api/domains/search-cloudflare - Search Cloudflare domains
router.get('/search-cloudflare', authenticate, async (req: Request, res: Response) => {
  const query = ((req.query.query as string) || '').toLowerCase().trim();
  const customToken = ((req.query.token as string) || '').trim() || undefined;

  try {
    const allZones = await listCloudflareZones(customToken);
    const existingDomains = Array.from(inMemoryDb.organizationDomains.values())
      .filter(d => d.status !== 'removed')
      .map(d => d.domain.toLowerCase());

    const filtered = allZones
      .filter(z => !query || z.name.toLowerCase().includes(query))
      .map(z => ({
        id: z.id,
        name: z.name,
        status: z.status,
        alreadyLinked: existingDomains.includes(z.name.toLowerCase()),
      }));

    return res.json({ zones: filtered });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to list Cloudflare zones' });
  }
});

// POST /api/domains/connect-cloudflare - Connect a Cloudflare-hosted domain or subdomain
router.post('/connect-cloudflare', authenticate, async (req: Request, res: Response) => {
  const user = req.user!;
  const { domain, cfZoneId, customToken } = req.body;

  if (!domain) {
    return res.status(400).json({ error: 'Domain name is required.' });
  }

  const cleanDomain = domain.toLowerCase().trim();

  // Check if domain already attached to another org
  const existing = Array.from(inMemoryDb.organizationDomains.values()).find(
    d => d.domain.toLowerCase() === cleanDomain && d.status !== 'removed'
  );
  if (existing && existing.organization_id !== user.organizationId) {
    return res.status(409).json({ error: 'This domain is already linked to another organization.' });
  }

  try {
    let targetZoneId = cfZoneId;
    if (!targetZoneId) {
      const match = await findCloudflareZoneForDomain(cleanDomain, customToken);
      if (match) targetZoneId = match.id;
    }

    if (!targetZoneId) {
      return res.status(400).json({
        error: `Could not locate "${cleanDomain}" in the Cloudflare account. Please ensure the zone exists or add it as an external domain.`,
      });
    }

    const record = await connectCloudflareZoneDomain(
      user.organizationId,
      user.id,
      cleanDomain,
      targetZoneId,
      customToken
    );

    return res.json({
      success: true,
      message: `Domain ${cleanDomain} linked and Cloudflare DNS CNAME auto-configured!`,
      domain: record,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to connect Cloudflare domain' });
  }
});

// POST /api/domains/provision-subdomain - Provision free *.vertext.online subdomain
router.post('/provision-subdomain', authenticate, async (req: Request, res: Response) => {
  const user = req.user!;
  const { subdomain } = req.body;

  if (!subdomain) {
    return res.status(400).json({ error: 'Subdomain prefix is required.' });
  }

  try {
    const record = await provisionSubdomain(user.organizationId, user.id, subdomain);
    return res.json({
      success: true,
      message: `Subdomain ${record.domain} activated successfully!`,
      domain: record,
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Failed to provision subdomain' });
  }
});

// GET /api/domains/check-availability - Check domain availability via authoritative DNS & Cloudflare
router.get('/check-availability', authenticate, async (req: Request, res: Response) => {
  const domain = ((req.query.domain as string) || '').toLowerCase().trim();
  if (!domain) return res.status(400).json({ error: 'Domain name is required.' });

  const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '';

  try {
    // 1. Check if domain already exists in Cloudflare zones
    const zoneMatch = await findCloudflareZoneForDomain(domain);
    if (zoneMatch) {
      return res.json({
        available: false,
        registered: true,
        alreadyInCloudflare: true,
        domain,
        message: `This domain is already in your Cloudflare account! You can link it instantly using "Cloudflare Auto-Connect".`,
      });
    }

    // 2. Query authoritative DNS over HTTPS (Cloudflare 1.1.1.1) for NS & SOA records
    const nsResp = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=NS`, {
      headers: { 'Accept': 'application/dns-json' },
    });
    const nsData: any = await nsResp.json();
    const hasNs = nsData.Status === 0 && Array.isArray(nsData.Answer) && nsData.Answer.length > 0;

    const soaResp = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=SOA`, {
      headers: { 'Accept': 'application/dns-json' },
    });
    const soaData: any = await soaResp.json();
    const hasSoa = soaData.Status === 0 && Array.isArray(soaData.Answer) && soaData.Answer.length > 0;

    const isRegistered = hasNs || hasSoa;

    if (isRegistered) {
      return res.json({
        available: false,
        registered: true,
        domain,
        message: `Domain ${domain} is already registered. If you own it, you can transfer it to Cloudflare or use Cloudflare Auto-Connect.`,
      });
    }

    return res.json({
      available: true,
      registered: false,
      price: 14.99,
      domain,
      redirectUrl: `https://dash.cloudflare.com/${CF_ACCOUNT_ID}/domains/register?search=${encodeURIComponent(domain)}`,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to check domain availability' });
  }
});

// POST /api/domains/buy-domain - Redirect to Cloudflare Registrar to buy domain
router.post('/buy-domain', authenticate, async (req: Request, res: Response) => {
  const user = req.user!;
  const { domain } = req.body;

  if (!domain) {
    return res.status(400).json({ error: 'Domain name is required.' });
  }

  const cleanDomain = domain.toLowerCase().trim();
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]\.[a-z]{2,}$/i.test(cleanDomain)) {
    return res.status(400).json({ error: 'Invalid domain format. Example: mybranddevices.com' });
  }

  const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '';

  // ── Create a state token so we can link the purchase back to this org ──
  // State = base64(orgId:userId:domain:timestamp) — also stored in pendingPurchases
  const stateToken = crypto.randomBytes(16).toString('hex');
  pendingPurchases.set(stateToken, {
    organizationId: user.organizationId,
    userId: user.id,
    domain: cleanDomain,
    createdAt: Date.now(),
  });

  // The return_url brings the customer back to the Vertex settings page after payment.
  // The ?vtx_state= param lets the UI call /poll-purchase to auto-activate.
  const FRONTEND_URL = process.env.FRONTEND_URL || 'https://vertext.online';
  const returnUrl = `${FRONTEND_URL}/settings?vtx_state=${stateToken}&vtx_domain=${encodeURIComponent(cleanDomain)}`;

  // Record intent in audit log
  inMemoryDb.auditLogs.unshift({
    id: `audit-${Date.now()}`,
    organization_id: user.organizationId,
    user_id: user.id,
    action: 'DOMAIN_BUY_INITIATED',
    resource_type: 'domain',
    resource_id: cleanDomain,
    details: { domain: cleanDomain, stateToken, action: 'redirected_to_cloudflare' },
    created_at: new Date().toISOString(),
  });
  inMemoryDb.save();

  return res.json({
    success: true,
    stateToken,
    redirectUrl: `https://dash.cloudflare.com/${CF_ACCOUNT_ID}/domains/register?search=${encodeURIComponent(cleanDomain)}`,
    returnUrl,
    message: `Opening Cloudflare Registrar to purchase ${cleanDomain}. After payment, you will be returned here and the domain will auto-activate.`,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MECHANISM 1: Cloudflare Webhook
// Cloudflare sends a POST to this URL after a domain is purchased/activated.
// Configure in: Cloudflare Dashboard → Notifications → Webhooks
//   URL: https://api.vertext.online/api/domains/webhook/cloudflare
//   Secret: value of CLOUDFLARE_WEBHOOK_SECRET env var
// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC — no authenticate middleware (Cloudflare calls this, not the browser)
router.post('/webhook/cloudflare', async (req: Request, res: Response) => {
  // 1. Verify the HMAC-SHA256 signature Cloudflare attaches
  const webhookSecret = process.env.CLOUDFLARE_WEBHOOK_SECRET || '';
  if (webhookSecret) {
    const signature = req.headers['cf-webhook-auth'] as string || '';
    const body = JSON.stringify(req.body);
    const expected = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');
    if (!signature || signature !== `sha256=${expected}`) {
      console.warn('[Webhook] Invalid Cloudflare signature — rejected');
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }
  }

  // 2. Parse the event — Cloudflare Registrar sends event types like:
  //    "zone.created", "registrar.domain.registered", "audit_log" etc.
  const event = req.body;
  console.log('[Webhook] Cloudflare event received:', JSON.stringify(event).slice(0, 300));

  const eventType: string = event?.alert_type || event?.event_type || event?.type || '';
  // Domain name may be in different locations depending on event shape
  const domainName: string = (
    event?.data?.name ||
    event?.data?.domain ||
    event?.zones?.[0]?.name ||
    event?.payload?.name ||
    ''
  ).toLowerCase().trim();

  if (!domainName) {
    return res.json({ received: true, note: 'No domain name in payload — ignored' });
  }

  // 3. Find the matching pending purchase record for this domain
  let matchingState: PendingPurchase | undefined;
  let matchingStateToken = '';
  for (const [token, pending] of pendingPurchases) {
    if (pending.domain === domainName) {
      matchingState = pending;
      matchingStateToken = token;
      break;
    }
  }

  if (!matchingState) {
    // Domain purchased but no pending entry — could be a direct CF purchase.
    // Log it and move on; the customer can use polling or manual connect.
    console.log(`[Webhook] Domain ${domainName} has no pending purchase record — event logged only`);
    return res.json({ received: true, note: 'Domain not in pending purchase queue' });
  }

  try {
    // 4. Find the new Cloudflare zone for this domain (may take a moment after purchase)
    const zone = await findCloudflareZoneForDomain(domainName);
    if (!zone) {
      console.warn(`[Webhook] Zone for ${domainName} not yet visible in CF API — will retry on poll`);
      return res.json({ received: true, note: 'Zone not yet propagated — will activate on next poll' });
    }

    // 5. Auto-create CNAME → app.vertext.online and persist the domain record
    const record = await connectCloudflareZoneDomain(
      matchingState.organizationId,
      matchingState.userId,
      domainName,
      zone.id,
    );

    // 6. Consume the pending entry
    pendingPurchases.delete(matchingStateToken);

    // Audit log
    inMemoryDb.auditLogs.unshift({
      id: `audit-${Date.now()}`,
      organization_id: matchingState.organizationId,
      user_id: matchingState.userId,
      action: 'DOMAIN_AUTO_ACTIVATED_WEBHOOK',
      resource_type: 'domain',
      resource_id: record.id,
      details: { domain: domainName, trigger: 'cloudflare_webhook', event_type: eventType },
      created_at: new Date().toISOString(),
    });
    inMemoryDb.save();

    console.log(`[Webhook] ✅ Domain ${domainName} auto-activated for org ${matchingState.organizationId}`);
    return res.json({ received: true, activated: true, domain: domainName });
  } catch (err: any) {
    console.error(`[Webhook] Failed to auto-activate ${domainName}:`, err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// MECHANISM 2: Customer-triggered polling (after returning from Cloudflare)
// Called by the frontend when the customer returns from Cloudflare Registrar
// with vtx_state= in the URL.  Vertex checks if the zone now exists in CF and
// activates it if found.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/poll-purchase', authenticate, async (req: Request, res: Response) => {
  const user = req.user!;
  const { stateToken, domain, customToken } = req.body;

  if (!domain && !stateToken) {
    return res.status(400).json({ error: 'domain or stateToken is required.' });
  }

  let cleanDomain = (domain || '').toLowerCase().trim();
  let pending = stateToken ? pendingPurchases.get(stateToken) : undefined;

  if (!cleanDomain && pending) {
    cleanDomain = pending.domain;
  }

  // Check if domain is already active for this org
  const existing = Array.from(inMemoryDb.organizationDomains.values()).find(
    d => d.domain === cleanDomain && d.organization_id === user.organizationId && d.status === 'active'
  );
  if (existing) {
    return res.json({ success: true, alreadyActive: true, domain: existing, message: `${cleanDomain} is active on your dashboard!` });
  }

  try {
    // Check if Cloudflare now has a zone for this domain
    const zone = await findCloudflareZoneForDomain(cleanDomain, customToken);
    if (!zone) {
      return res.status(202).json({
        success: false,
        pending: true,
        message: `${cleanDomain} is not yet detected in Cloudflare. Waiting for payment / registration to complete...`,
      });
    }

    // Zone found! Auto-configure DNS and connect to dashboard
    const record = await connectCloudflareZoneDomain(
      user.organizationId,
      user.id,
      cleanDomain,
      zone.id,
      customToken
    );

    if (stateToken) pendingPurchases.delete(stateToken);

    inMemoryDb.auditLogs.unshift({
      id: `audit-${Date.now()}`,
      organization_id: user.organizationId,
      user_id: user.id,
      action: 'DOMAIN_AUTO_ACTIVATED_POLL',
      resource_type: 'domain',
      resource_id: record.id,
      details: { domain: cleanDomain, trigger: 'customer_poll' },
      created_at: new Date().toISOString(),
    });
    inMemoryDb.save();

    return res.json({
      success: true,
      message: `🎉 ${cleanDomain} is now live and linked to your dashboard! DNS auto-configured.`,
      domain: record,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to activate domain' });
  }
});

// POST /api/domains/transfer-cloudflare - Transfer existing domain DNS to Cloudflare
router.post('/transfer-cloudflare', authenticate, async (req: Request, res: Response) => {
  const user = req.user!;
  const { domain, customToken } = req.body;

  if (!domain) {
    return res.status(400).json({ error: 'Domain name is required.' });
  }

  const cleanDomain = domain.toLowerCase().trim();

  // Validate format
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]\.[a-z]{2,}$/i.test(cleanDomain)) {
    return res.status(400).json({ error: 'Invalid domain format. Example: mybrand.com' });
  }

  try {
    const result = await createCloudflareZoneForTransfer(
      user.organizationId,
      user.id,
      cleanDomain,
      customToken
    );

    if (result.alreadyInCloudflare) {
      return res.json({
        success: true,
        alreadyInCloudflare: true,
        message: `Domain ${cleanDomain} was already in Cloudflare and has been connected to your dashboard instantly!`,
        domain: result.domain,
        nameservers: [],
      });
    }

    return res.json({
      success: true,
      alreadyInCloudflare: false,
      message: `Zone created in Cloudflare! Update your nameservers at your domain registrar to complete the link.`,
      domain: result.domain,
      nameservers: result.nameservers,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to initiate domain transfer' });
  }
});

// POST /api/domains/:id/check-transfer - Verify if Cloudflare nameservers are active
router.post('/:id/check-transfer', authenticate, async (req: Request, res: Response) => {
  const user = req.user!;
  const { id } = req.params;
  const { customToken } = req.body;

  const result = await checkCloudflareZoneActivation(id, user.organizationId, customToken);
  if (result.activated) {
    return res.json({
      success: true,
      activated: true,
      message: 'Nameservers verified! Domain is active and routed to your dashboard.',
    });
  } else {
    return res.status(400).json({
      success: false,
      activated: false,
      error: result.error,
      nameservers: result.nameservers,
    });
  }
});

// POST /api/domains/external - Add external domain (manual DNS CNAME / TXT)
router.post('/external', authenticate, async (req: Request, res: Response) => {
  const user = req.user!;
  const { domain } = req.body;

  if (!domain) {
    return res.status(400).json({ error: 'Domain name is required.' });
  }

  const cleanDomain = domain.toLowerCase().trim();
  try {
    const result = await addExternalDomain(user.organizationId, user.id, cleanDomain);
    return res.json({
      success: true,
      message: `Domain ${cleanDomain} added. Please configure your DNS records to activate.`,
      ...result,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to add external domain' });
  }
});

// POST /api/domains/:id/verify - Verify external domain TXT record
router.post('/:id/verify', authenticate, async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await verifyExternalDomain(id);
  if (result.verified) {
    return res.json({ success: true, message: 'Domain verified and active!' });
  } else {
    return res.status(400).json({ success: false, error: result.error });
  }
});

// DELETE /api/domains/:id - Remove domain
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  const user = req.user!;
  const { id } = req.params;

  const success = await removeDomain(id, user.organizationId);
  if (!success) {
    return res.status(404).json({ error: 'Domain not found or unauthorized.' });
  }

  return res.json({ success: true, message: 'Domain removed.' });
});

export default router;
