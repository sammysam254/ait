/**
 * Vertex SaaS — Custom Domain Multi-Tenant Service
 *
 * Two flows:
 *  A) Domain already in Sammy's Cloudflare account → one-click connect (auto DNS CNAME)
 *  B) External domain → provide CNAME target + TXT verification record for customer to add manually
 *
 * Per-domain routing: every request's Host header is resolved to an org.
 * Workers can ONLY log in through their own org's domain.
 */

import { v4 as uuidv4 } from 'uuid';
import { inMemoryDb, OrganizationDomain } from '../database/supabaseClient';
import { config } from '../config';

const CF_API = 'https://api.cloudflare.com/client/v4';
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN || config.cloudflare?.apiToken || '';
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || config.cloudflare?.accountId || '';
const CF_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || config.cloudflare?.zoneId || '';
const CF_ROOT_DOMAIN = process.env.CLOUDFLARE_DOMAIN || 'vertext.online';

// The CNAME target all custom domains point to (our server's stable hostname)
const VERTEX_CNAME_TARGET = `app.${CF_ROOT_DOMAIN}`;

// Cache: hostname → organizationId (refreshed on domain add/remove/verify)
const domainToOrgCache = new Map<string, string>();

/** Rebuild the in-memory hostname→org cache from persisted domains */
export function rebuildDomainCache() {
  domainToOrgCache.clear();
  for (const d of inMemoryDb.organizationDomains.values()) {
    if (d.status === 'active') {
      domainToOrgCache.set(d.domain.toLowerCase(), d.organization_id);
    }
  }
}

/** Resolve a hostname (from the Host header) to an organizationId */
export function resolveOrgFromHost(hostname: string): string | null {
  if (!hostname) return null;
  // Strip port if present
  const host = hostname.split(':')[0].toLowerCase();
  // Check exact match first
  if (domainToOrgCache.has(host)) return domainToOrgCache.get(host)!;
  // Wildcard: *.vertext.online subdomains — look for subdomain record
  if (host.endsWith(`.${CF_ROOT_DOMAIN}`)) {
    const sub = host.replace(`.${CF_ROOT_DOMAIN}`, '');
    // Try subdomain key stored as "sub.vertext.online"
    if (domainToOrgCache.has(host)) return domainToOrgCache.get(host)!;
    // Also check raw subdomain
    if (domainToOrgCache.has(sub)) return domainToOrgCache.get(sub)!;
  }
  return null;
}

/** Call Cloudflare API */
async function cfFetch(path: string, method = 'GET', body?: object, customToken?: string): Promise<any> {
  const token = customToken || CF_TOKEN;
  const url = `${CF_API}${path}`;
  const opts: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  const res = await fetch(url, opts);
  return res.json();
}

/** List all Cloudflare zones (optionally using a custom token) */
export async function listCloudflareZones(customToken?: string): Promise<{ id: string; name: string; status: string }[]> {
  const token = customToken || CF_TOKEN;
  if (!token) return [];
  try {
    // Fetch all accessible zones without restricting by account ID
    const data = await cfFetch('/zones?per_page=100', 'GET', undefined, token);
    if (!data.success) return [];
    return (data.result || []).map((z: any) => ({ id: z.id, name: z.name, status: z.status }));
  } catch (e) {
    return [];
  }
}

/** Search if a specific domain is in Cloudflare account */
export async function findCloudflareZoneForDomain(domain: string, customToken?: string): Promise<{ id: string; name: string } | null> {
  const token = customToken || CF_TOKEN;
  if (!token) return null;
  try {
    const domainParts = domain.toLowerCase().split('.');
    for (let i = 0; i < domainParts.length - 1; i++) {
      const candidate = domainParts.slice(i).join('.');
      const data = await cfFetch(`/zones?name=${encodeURIComponent(candidate)}`, 'GET', undefined, token);
      if (data.success && data.result?.length > 0) {
        return { id: data.result[0].id, name: data.result[0].name };
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * FLOW A: Domain is in Cloudflare — auto-add CNAME pointing to Vertex
 * Cleans up any conflicting A / AAAA records automatically to prevent
 * "An A, AAAA, or CNAME record with that host already exists" error.
 */
export async function connectCloudflareZoneDomain(
  organizationId: string,
  userId: string,
  domain: string,            // e.g. "app.clienta.com" or "clienta.com"
  cfZoneId: string,
  customToken?: string,
): Promise<OrganizationDomain> {
  const id = uuidv4();
  const cleanDomain = domain.toLowerCase().trim();
  const verificationToken = `vtx-verify=${uuidv4().replace(/-/g, '').slice(0, 24)}`;
  const tokenToUse = customToken || CF_TOKEN;

  let cfDnsRecordId: string | undefined;
  let dnsError: string | undefined;

  if (tokenToUse && cfZoneId) {
    try {
      // 1. Fetch ALL existing records matching this exact hostname (A, AAAA, CNAME)
      const existing = await cfFetch(`/zones/${cfZoneId}/dns_records?name=${encodeURIComponent(cleanDomain)}`, 'GET', undefined, tokenToUse);
      
      if (existing.success && Array.isArray(existing.result)) {
        for (const rec of existing.result) {
          if (rec.type === 'A' || rec.type === 'AAAA') {
            // Delete conflicting A or AAAA records so CNAME can be installed cleanly
            console.log(`[Cloudflare] Deleting conflicting ${rec.type} record for ${cleanDomain} (ID: ${rec.id})`);
            await cfFetch(`/zones/${cfZoneId}/dns_records/${rec.id}`, 'DELETE', undefined, tokenToUse);
          } else if (rec.type === 'CNAME') {
            cfDnsRecordId = rec.id;
          }
        }
      }

      // 2. Create or update CNAME pointing to Vertex CNAME target
      if (cfDnsRecordId) {
        const updated = await cfFetch(`/zones/${cfZoneId}/dns_records/${cfDnsRecordId}`, 'PUT', {
          type: 'CNAME',
          name: cleanDomain,
          content: VERTEX_CNAME_TARGET,
          ttl: 1, // Auto
          proxied: true,
        }, tokenToUse);
        if (!updated.success) {
          dnsError = updated.errors?.[0]?.message || 'Failed to update existing CNAME record';
        }
      } else {
        const created = await cfFetch(`/zones/${cfZoneId}/dns_records`, 'POST', {
          type: 'CNAME',
          name: cleanDomain,
          content: VERTEX_CNAME_TARGET,
          ttl: 1,
          proxied: true,
        }, tokenToUse);
        if (created.success) {
          cfDnsRecordId = created.result?.id;
        } else {
          dnsError = created.errors?.[0]?.message || 'DNS creation failed';
        }
      }

      // 3. Bind Cloudflare Worker route so Netlify serves custom domain with 200 OK without "Site not found"
      try {
        await cfFetch(`/zones/${cfZoneId}/workers/routes`, 'POST', {
          pattern: `*${cleanDomain}/*`,
          script: 'vertex-domain-router',
        }, tokenToUse);
      } catch (e) {}
    } catch (e: any) {
      dnsError = e.message;
    }
  }

  const domainRecord: OrganizationDomain = {
    id,
    organization_id: organizationId,
    domain: cleanDomain,
    domain_type: cleanDomain.endsWith(`.${CF_ROOT_DOMAIN}`) ? 'subdomain' : 'custom',
    status: (tokenToUse && cfZoneId && !dnsError) ? 'active' : 'pending_verification',
    cf_zone_id: cfZoneId,
    cf_dns_record_id: cfDnsRecordId,
    verification_token: verificationToken,
    ssl_status: 'pending',
    added_by: userId,
    verified_at: (!dnsError && tokenToUse) ? new Date().toISOString() : undefined,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  inMemoryDb.organizationDomains.set(id, domainRecord);
  inMemoryDb.save();
  rebuildDomainCache();

  return domainRecord;
}

/**
 * FLOW B: External domain (not in Sammy's CF) — provide instructions for customer
 * Returns the domain record with CNAME target + verification TXT they need to add manually.
 */
export async function addExternalDomain(
  organizationId: string,
  userId: string,
  domain: string,
): Promise<OrganizationDomain & { cname_target: string; txt_name: string; txt_value: string }> {
  const id = uuidv4();
  const cleanDomain = domain.toLowerCase().trim();
  const verificationToken = `vtx-verify=${uuidv4().replace(/-/g, '').slice(0, 24)}`;

  const domainRecord: OrganizationDomain = {
    id,
    organization_id: organizationId,
    domain: cleanDomain,
    domain_type: 'custom',
    status: 'pending_verification',
    verification_token: verificationToken,
    ssl_status: 'pending',
    added_by: userId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  inMemoryDb.organizationDomains.set(id, domainRecord);
  inMemoryDb.save();

  return {
    ...domainRecord,
    cname_target: VERTEX_CNAME_TARGET,
    txt_name: `_vtx-verify.${cleanDomain}`,
    txt_value: verificationToken,
  };
}

/**
 * Provision a free *.vertext.online subdomain for an org (immediate, no customer DNS needed)
 * e.g. "acme.vertext.online"
 */
export async function provisionSubdomain(
  organizationId: string,
  userId: string,
  subdomain: string,          // just the slug, e.g. "acme"
): Promise<OrganizationDomain> {
  const cleanSlug = subdomain.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
  const fullDomain = `${cleanSlug}.${CF_ROOT_DOMAIN}`;

  // Check if already taken
  for (const d of inMemoryDb.organizationDomains.values()) {
    if (d.domain === fullDomain && d.status !== 'removed') {
      throw new Error(`Subdomain ${fullDomain} is already in use.`);
    }
  }

  // Auto-add CNAME in Sammy's CF zone
  let cfDnsRecordId: string | undefined;
  if (CF_TOKEN && CF_ZONE_ID) {
    try {
      const created = await cfFetch(`/zones/${CF_ZONE_ID}/dns_records`, 'POST', {
        type: 'CNAME',
        name: fullDomain,
        content: VERTEX_CNAME_TARGET,
        ttl: 1,
        proxied: true,
      });
      if (created.success) cfDnsRecordId = created.result?.id;
    } catch (e) {}
  }

  const id = uuidv4();
  const domainRecord: OrganizationDomain = {
    id,
    organization_id: organizationId,
    domain: fullDomain,
    domain_type: 'subdomain',
    status: 'active',
    cf_zone_id: CF_ZONE_ID,
    cf_dns_record_id: cfDnsRecordId,
    ssl_status: 'pending',
    added_by: userId,
    verified_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  inMemoryDb.organizationDomains.set(id, domainRecord);
  inMemoryDb.save();
  rebuildDomainCache();

  return domainRecord;
}

/**
 * Verify an external domain by checking TXT record via DNS-over-HTTPS
 */
export async function verifyExternalDomain(domainId: string): Promise<{ verified: boolean; error?: string }> {
  const record = inMemoryDb.organizationDomains.get(domainId);
  if (!record) return { verified: false, error: 'Domain record not found.' };
  if (!record.verification_token) return { verified: false, error: 'No verification token set.' };

  const txtName = `_vtx-verify.${record.domain}`;
  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(txtName)}&type=TXT`, {
      headers: { 'Accept': 'application/dns-json' },
    });
    const data: any = await res.json();
    const answers: string[] = (data.Answer || []).map((a: any) => (a.data || '').replace(/"/g, ''));
    if (answers.includes(record.verification_token)) {
      record.status = 'active';
      record.verified_at = new Date().toISOString();
      record.updated_at = new Date().toISOString();
      inMemoryDb.organizationDomains.set(record.id, record);
      inMemoryDb.save();
      rebuildDomainCache();
      return { verified: true };
    }
    return { verified: false, error: `TXT record not found yet. Add: ${record.verification_token} to ${txtName}` };
  } catch (e: any) {
    return { verified: false, error: e.message };
  }
}

/**
 * FLOW C: Transfer existing registered domain to Cloudflare DNS
 * Creates a Cloudflare zone for the apex domain, pre-provisions the CNAME to app.vertext.online,
 * and returns the 2 Cloudflare nameservers for the user to point to at their registrar.
 */
export async function createCloudflareZoneForTransfer(
  organizationId: string,
  userId: string,
  domain: string,
  customToken?: string,
): Promise<{ domain: OrganizationDomain; nameservers: string[]; alreadyInCloudflare: boolean }> {
  const tokenToUse = customToken || CF_TOKEN;
  const cleanDomain = domain.toLowerCase().trim();

  // Extract apex domain (e.g. "sub.example.com" -> "example.com")
  const parts = cleanDomain.split('.');
  const apexDomain = parts.length > 2 ? parts.slice(-2).join('.') : cleanDomain;

  // 1. Check if zone already exists in Cloudflare
  const existingZone = await findCloudflareZoneForDomain(apexDomain, tokenToUse);
  if (existingZone) {
    // Zone is already present in Cloudflare! Auto-connect immediately
    const record = await connectCloudflareZoneDomain(
      organizationId,
      userId,
      cleanDomain,
      existingZone.id,
      tokenToUse
    );
    return { domain: record, nameservers: [], alreadyInCloudflare: true };
  }

  // 2. Zone does not exist in Cloudflare yet — create it
  if (!tokenToUse) {
    throw new Error('No Cloudflare credentials available to create zone.');
  }

  let accountIdToUse = CF_ACCOUNT_ID;
  if (customToken) {
    try {
      const accountsRes = await cfFetch('/accounts?per_page=1', 'GET', undefined, customToken);
      if (accountsRes.success && accountsRes.result?.[0]?.id) {
        accountIdToUse = accountsRes.result[0].id;
      }
    } catch {}
  }

  const createRes = await cfFetch('/zones', 'POST', {
    name: apexDomain,
    account: accountIdToUse ? { id: accountIdToUse } : undefined,
    jump_start: true,
    type: 'full',
  }, tokenToUse);

  if (!createRes.success) {
    const errorMsg = createRes.errors?.[0]?.message || 'Failed to create Cloudflare zone';
    throw new Error(errorMsg);
  }

  const zoneId = createRes.result?.id;
  const nameServers: string[] = createRes.result?.name_servers || [];

  // 3. Pre-create CNAME record in the new zone so routing is instant once nameservers point to CF
  let cfDnsRecordId: string | undefined;
  try {
    const dnsCreated = await cfFetch(`/zones/${zoneId}/dns_records`, 'POST', {
      type: 'CNAME',
      name: cleanDomain,
      content: VERTEX_CNAME_TARGET,
      ttl: 1,
      proxied: true,
    }, tokenToUse);
    if (dnsCreated.success) cfDnsRecordId = dnsCreated.result?.id;
  } catch (e) {
    console.warn(`[Cloudflare] Pre-creating CNAME in pending zone:`, e);
  }

  const id = uuidv4();
  const domainRecord: OrganizationDomain = {
    id,
    organization_id: organizationId,
    domain: cleanDomain,
    domain_type: 'custom',
    status: 'pending_verification',
    cf_zone_id: zoneId,
    cf_dns_record_id: cfDnsRecordId,
    nameservers: nameServers,
    ssl_status: 'pending',
    added_by: userId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  inMemoryDb.organizationDomains.set(id, domainRecord);
  inMemoryDb.save();

  return { domain: domainRecord, nameservers: nameServers, alreadyInCloudflare: false };
}

/**
 * Check if a Cloudflare zone has become active (nameservers verified by Cloudflare)
 */
export async function checkCloudflareZoneActivation(
  domainId: string,
  organizationId: string,
  customToken?: string
): Promise<{ activated: boolean; status: string; nameservers?: string[]; error?: string }> {
  const record = inMemoryDb.organizationDomains.get(domainId);
  if (!record || record.organization_id !== organizationId) {
    return { activated: false, status: 'not_found', error: 'Domain record not found.' };
  }

  const tokenToUse = customToken || CF_TOKEN;
  if (!record.cf_zone_id || !tokenToUse) {
    return { activated: false, status: record.status, error: 'No Cloudflare zone associated.' };
  }

  try {
    const zoneRes = await cfFetch(`/zones/${record.cf_zone_id}`, 'GET', undefined, tokenToUse);
    if (!zoneRes.success) {
      return { activated: false, status: 'error', error: zoneRes.errors?.[0]?.message || 'Failed to inspect zone' };
    }

    const cfStatus = zoneRes.result?.status; // 'active', 'pending', 'moved', etc.
    const nameServers: string[] = zoneRes.result?.name_servers || record.nameservers || [];

    if (cfStatus === 'active') {
      record.status = 'active';
      record.verified_at = new Date().toISOString();
      record.updated_at = new Date().toISOString();

      // Ensure CNAME is installed
      if (!record.cf_dns_record_id) {
        try {
          const cnameRes = await cfFetch(`/zones/${record.cf_zone_id}/dns_records`, 'POST', {
            type: 'CNAME',
            name: record.domain,
            content: VERTEX_CNAME_TARGET,
            ttl: 1,
            proxied: true,
          }, tokenToUse);
          if (cnameRes.success) record.cf_dns_record_id = cnameRes.result?.id;
        } catch {}
      }

      inMemoryDb.organizationDomains.set(record.id, record);
      inMemoryDb.save();
      rebuildDomainCache();

      return { activated: true, status: 'active', nameservers: nameServers };
    }

    // Trigger Cloudflare to re-check nameservers immediately
    try {
      await cfFetch(`/zones/${record.cf_zone_id}/activation_check`, 'PUT', undefined, tokenToUse);
    } catch {}

    return {
      activated: false,
      status: cfStatus,
      nameservers: nameServers,
      error: 'Cloudflare has not detected your nameserver change yet. Nameserver updates typically take 5–30 minutes to propagate worldwide.',
    };
  } catch (e: any) {
    return { activated: false, status: 'error', error: e.message };
  }
}

/** Remove a domain from an org */
export async function removeDomain(domainId: string, organizationId: string): Promise<boolean> {
  const record = inMemoryDb.organizationDomains.get(domainId);
  if (!record || record.organization_id !== organizationId) return false;

  // Delete CF DNS record if we created one
  if (CF_TOKEN && record.cf_zone_id && record.cf_dns_record_id) {
    try {
      await cfFetch(`/zones/${record.cf_zone_id}/dns_records/${record.cf_dns_record_id}`, 'DELETE');
    } catch (e) {}
  }

  // Also delete Cloudflare worker route if one was created for this domain
  if (CF_TOKEN && record.cf_zone_id) {
    try {
      const routesRes = await cfFetch(`/zones/${record.cf_zone_id}/workers/routes`);
      if (routesRes.success && Array.isArray(routesRes.result)) {
        for (const r of routesRes.result) {
          if (r.pattern && r.pattern.includes(record.domain)) {
            await cfFetch(`/zones/${record.cf_zone_id}/workers/routes/${r.id}`, 'DELETE');
          }
        }
      }
    } catch (e) {}
  }

  record.status = 'removed';
  record.updated_at = new Date().toISOString();
  inMemoryDb.organizationDomains.set(record.id, record);
  inMemoryDb.save();
  rebuildDomainCache();
  return true;
}

/** Get all active domains for an org */
export function getDomainsForOrg(organizationId: string): OrganizationDomain[] {
  return Array.from(inMemoryDb.organizationDomains.values())
    .filter(d => d.organization_id === organizationId && d.status !== 'removed');
}

/** Get the primary active domain for an org (used in invitation links) */
export function getPrimaryDomainForOrg(organizationId: string): string | null {
  const domains = getDomainsForOrg(organizationId).filter(d => d.status === 'active');
  if (domains.length === 0) return null;
  // Prefer custom over subdomain, then first added
  const custom = domains.find(d => d.domain_type === 'custom');
  return custom ? `https://${custom.domain}` : `https://${domains[0].domain}`;
}

// Seed the cache on module load
rebuildDomainCache();
