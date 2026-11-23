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

// GET /api/domains/check-availability - Check domain availability via Cloudflare Registrar
router.get('/check-availability', authenticate, async (req: Request, res: Response) => {
  const domain = ((req.query.domain as string) || '').toLowerCase().trim();
  if (!domain) return res.status(400).json({ error: 'Domain name is required.' });

  const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '';
  const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/registrar/domains/${encodeURIComponent(domain)}`,
      { headers: { 'Authorization': `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' } }
    );
    const data: any = await response.json();
    // If Cloudflare returns a result for a registered domain it means NOT available for purchase
    // Availability check: use the registrar search endpoint
    const checkResp = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/registrar/domains?name=${encodeURIComponent(domain)}`,
      { headers: { 'Authorization': `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' } }
    );
    const checkData: any = await checkResp.json();
    const price = data.result?.current_price || checkData.result?.[0]?.current_price || 14.99;
    const available = !data.success || !data.result?.registered;
    return res.json({
      available,
      price,
      domain,
      redirectUrl: `https://dash.cloudflare.com/${CF_ACCOUNT_ID}/domains/register?search=${encodeURIComponent(domain)}`,
    });
  } catch (err: any) {
    // Fallback: assume available if CF API errors (e.g. registrar access not enabled)
    return res.json({
      available: true,
      price: 14.99,
      domain,
      redirectUrl: `https://www.cloudflare.com/products/registrar/?utm_source=vertex&search=${encodeURIComponent(domain)}`,
    });
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

  // Record intent in audit log
  inMemoryDb.auditLogs.unshift({
    id: `audit-${Date.now()}`,
    organization_id: user.organizationId,
    user_id: user.id,
    action: 'DOMAIN_BUY_INITIATED',
    resource_type: 'domain',
    resource_id: cleanDomain,
    details: { domain: cleanDomain, action: 'redirected_to_cloudflare' },
    created_at: new Date().toISOString(),
  });
  inMemoryDb.save();

  return res.json({
    success: true,
    redirectUrl: `https://dash.cloudflare.com/${CF_ACCOUNT_ID}/domains/register?search=${encodeURIComponent(cleanDomain)}`,
    message: `Opening Cloudflare Registrar to purchase ${cleanDomain}. After purchase completes, return here and use "Cloudflare Auto-Connect" to link your domain — it will appear automatically.`,
  });
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
