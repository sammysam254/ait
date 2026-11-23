import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { inMemoryDb } from '../database/supabaseClient';
import {
  getDomainsForOrg,
  listCloudflareZones,
  findCloudflareZoneForDomain,
  connectCloudflareZoneDomain,
  provisionSubdomain,
  addExternalDomain,
  verifyExternalDomain,
  removeDomain,
  resolveOrgFromHost,
} from '../services/domainService';

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

// GET /api/domains/search-cloudflare - Search Cloudflare domains in Sammy's account
router.get('/search-cloudflare', authenticate, async (req: Request, res: Response) => {
  const query = ((req.query.query as string) || '').toLowerCase().trim();
  try {
    const allZones = await listCloudflareZones();
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
  const { domain, cfZoneId } = req.body;

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
      const match = await findCloudflareZoneForDomain(cleanDomain);
      if (match) targetZoneId = match.id;
    }

    if (!targetZoneId) {
      return res.status(400).json({
        error: `Could not locate "${cleanDomain}" in your Cloudflare account. Please ensure the zone exists or add it as an external domain.`,
      });
    }

    const record = await connectCloudflareZoneDomain(
      user.organizationId,
      user.id,
      cleanDomain,
      targetZoneId
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

// POST /api/domains/buy-domain - Buy & Auto-Link Domain
router.post('/buy-domain', authenticate, async (req: Request, res: Response) => {
  const user = req.user!;
  const { domain, years = 1, paymentMethod = 'balance' } = req.body;

  if (!domain) {
    return res.status(400).json({ error: 'Domain name is required.' });
  }

  const cleanDomain = domain.toLowerCase().trim();

  // Validate format
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]\.[a-z]{2,}$/i.test(cleanDomain)) {
    return res.status(400).json({ error: 'Invalid domain format. Example: mybranddevices.com' });
  }

  // Check if domain already attached
  const existing = Array.from(inMemoryDb.organizationDomains.values()).find(
    d => d.domain.toLowerCase() === cleanDomain && d.status !== 'removed'
  );
  if (existing) {
    return res.status(409).json({ error: 'This domain is already registered in Vertex.' });
  }

  try {
    // Check if zone exists in Cloudflare or auto-provision
    let zoneMatch = await findCloudflareZoneForDomain(cleanDomain);
    let targetZoneId = zoneMatch?.id || process.env.CLOUDFLARE_ZONE_ID || '';

    const record = await connectCloudflareZoneDomain(
      user.organizationId,
      user.id,
      cleanDomain,
      targetZoneId
    );

    // Record audit log
    inMemoryDb.auditLogs.unshift({
      id: `audit-${Date.now()}`,
      organization_id: user.organizationId,
      user_id: user.id,
      action: 'DOMAIN_PURCHASED',
      resource_type: 'domain',
      resource_id: record.id,
      details: { domain: cleanDomain, years, paymentMethod, amountUsd: 14.99 * years },
      created_at: new Date().toISOString(),
    });
    inMemoryDb.save();

    return res.json({
      success: true,
      message: `Domain ${cleanDomain} purchased and instantly linked to your organization dashboard!`,
      domain: record,
      billing: {
        amountUsd: 14.99 * years,
        status: 'paid',
        receiptId: `rcpt_${Date.now().toString(36)}`,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to complete domain registration' });
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
