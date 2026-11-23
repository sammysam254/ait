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
async function cfFetch(path: string, method = 'GET', body?: object): Promise<any> {
  const url = `${CF_API}${path}`;
  const opts: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${CF_TOKEN}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  const res = await fetch(url, opts);
  return res.json();
}

/** List all Cloudflare zones in Sammy's account (for the domain search/picker) */
export async function listCloudflareZones(): Promise<{ id: string; name: string; status: string }[]> {
  if (!CF_TOKEN) return [];
  try {
    const data = await cfFetch(`/zones?account.id=${CF_ACCOUNT_ID}&per_page=100`);
    if (!data.success) return [];
    return (data.result || []).map((z: any) => ({ id: z.id, name: z.name, status: z.status }));
  } catch (e) {
    return [];
  }
}

/** Search if a specific domain is in Sammy's Cloudflare account */
export async function findCloudflareZoneForDomain(domain: string): Promise<{ id: string; name: string } | null> {
  if (!CF_TOKEN) return null;
  try {
    // Try exact zone name match first
    const domainParts = domain.toLowerCase().split('.');
    // Try matching apex domain (last two parts) and sub-domains
    for (let i = 0; i < domainParts.length - 1; i++) {
      const candidate = domainParts.slice(i).join('.');
      const data = await cfFetch(`/zones?name=${encodeURIComponent(candidate)}&account.id=${CF_ACCOUNT_ID}`);
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
 * FLOW A: Domain is in Sammy's Cloudflare — auto-add CNAME pointing to Vertex
 */
export async function connectCloudflareZoneDomain(
  organizationId: string,
  userId: string,
  domain: string,            // e.g. "app.clienta.com"  or "clienta.com"
  cfZoneId: string,
): Promise<OrganizationDomain> {
  const id = uuidv4();
  const cleanDomain = domain.toLowerCase().trim();
  const verificationToken = `vtx-verify=${uuidv4().replace(/-/g, '').slice(0, 24)}`;

  // Add CNAME record pointing to our app
  let cfDnsRecordId: string | undefined;
  let dnsError: string | undefined;

  if (CF_TOKEN && cfZoneId) {
    try {
      // Check if a record already exists
      const existing = await cfFetch(`/zones/${cfZoneId}/dns_records?name=${cleanDomain}&type=CNAME`);
      if (existing.success && existing.result?.length > 0) {
        cfDnsRecordId = existing.result[0].id;
        // Patch it to point to our target
        await cfFetch(`/zones/${cfZoneId}/dns_records/${cfDnsRecordId}`, 'PUT', {
          type: 'CNAME',
          name: cleanDomain,
          content: VERTEX_CNAME_TARGET,
          ttl: 1, // Auto
          proxied: true,
        });
      } else {
        const created = await cfFetch(`/zones/${cfZoneId}/dns_records`, 'POST', {
          type: 'CNAME',
          name: cleanDomain,
          content: VERTEX_CNAME_TARGET,
          ttl: 1,
          proxied: true,
        });
        if (created.success) {
          cfDnsRecordId = created.result?.id;
        } else {
          dnsError = created.errors?.[0]?.message || 'DNS creation failed';
        }
      }
    } catch (e: any) {
      dnsError = e.message;
    }
  }

  const domainRecord: OrganizationDomain = {
    id,
    organization_id: organizationId,
    domain: cleanDomain,
    domain_type: cleanDomain.endsWith(`.${CF_ROOT_DOMAIN}`) ? 'subdomain' : 'custom',
    status: (CF_TOKEN && cfZoneId && !dnsError) ? 'active' : 'pending_verification',
    cf_zone_id: cfZoneId,
    cf_dns_record_id: cfDnsRecordId,
    verification_token: verificationToken,
    ssl_status: 'pending',
    added_by: userId,
    verified_at: (!dnsError && CF_TOKEN) ? new Date().toISOString() : undefined,
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
