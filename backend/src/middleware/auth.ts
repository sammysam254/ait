import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { inMemoryDb } from '../database/supabaseClient';
import { resolveOrgFromHost } from '../services/domainService';

const SUPABASE_FALLBACK_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhtZnNoeHhtcmF4cmRnbWtwd3ZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUwMTIwNDUsImV4cCI6MjExMDU4ODA0NX0.a1CmJ4CuxZpPTeBx4GHcth1uUhYyLbTRnxmWQ6L7yvo';
const verifiedSupabaseTokenCache = new Map<string, { user: any; expiresAt: number }>();

async function verifySupabaseToken(token: string): Promise<any | null> {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const cached = verifiedSupabaseTokenCache.get(tokenHash);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  const apiKey = config.supabaseAnonKey || config.supabaseServiceRoleKey || SUPABASE_FALLBACK_ANON_KEY;
  const resp = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: apiKey,
    },
  });

  if (!resp.ok) {
    return null;
  }

  const supaUser = (await resp.json()) as any;
  if (!supaUser || !supaUser.id || !supaUser.email) {
    return null;
  }

  const decoded = jwt.decode(token) as any;
  const tokenExpMs = decoded?.exp ? decoded.exp * 1000 : Date.now() + 5 * 60_000;
  const cacheUntil = Math.min(tokenExpMs, Date.now() + 5 * 60_000);
  verifiedSupabaseTokenCache.set(tokenHash, { user: supaUser, expiresAt: cacheUntil });

  if (verifiedSupabaseTokenCache.size > 1000) {
    const now = Date.now();
    for (const [k, v] of verifiedSupabaseTokenCache.entries()) {
      if (v.expiresAt <= now) verifiedSupabaseTokenCache.delete(k);
    }
  }

  return supaUser;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  system_role: 'admin' | 'customer' | 'assigned_user';
  organizationId: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  // Accept from Bearer header OR query string (needed for cross-subdomain auth_token transfer)
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : req.query.token as string;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. No token provided.' });
  }

  // Sanitise token length to prevent DoS via oversized strings
  if (token.length > 4096) {
    return res.status(401).json({ error: 'Invalid token.' });
  }

  try {
    let decoded: any;
    try {
      // Primary: verify with our own JWT secret
      decoded = jwt.verify(token, config.jwtSecret) as any;
    } catch (e: any) {
      if (e.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired. Please log in again.' });
      }
      // Fallback: cryptographically/remotely verify Supabase access_token via Supabase Auth API
      const supaUser = await verifySupabaseToken(token);
      if (!supaUser) {
        return res.status(401).json({ error: 'Invalid or expired token.' });
      }
      decoded = {
        id: supaUser.id,
        sub: supaUser.id,
        email: supaUser.email,
        user_metadata: supaUser.user_metadata || {},
      };
    }

    if (!decoded) {
      return res.status(401).json({ error: 'Invalid token structure.' });
    }

    const userId = decoded.id || decoded.sub;
    const userEmail = (decoded.email || decoded.user_metadata?.email || '').toLowerCase().trim();
    const isSuperAdmin = userEmail === 'sammyseth260@gmail.com';

    // Check if this user is a subordinate worker in an organization
    const assignedUser = Array.from(inMemoryDb.assignedUsers.values()).find(
      au => (userId && au.user_id === userId) || (userEmail && au.email.toLowerCase().trim() === userEmail)
    );

    let profile = inMemoryDb.profiles.get(userId);
    if (!profile) {
      profile = {
        id: userId,
        email: userEmail,
        full_name: isSuperAdmin ? 'Sammy Seth (Super Admin)' : (decoded.user_metadata?.full_name || userEmail.split('@')[0]),
        system_role: isSuperAdmin ? 'admin' : (assignedUser ? 'assigned_user' : 'customer'),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      inMemoryDb.profiles.set(userId, profile);
      inMemoryDb.save();
    } else {
      // SECURITY ENFORCEMENT: Never allow non-superadmin to have admin privileges under any circumstances
      if (!isSuperAdmin && profile.system_role === 'admin') {
        profile.system_role = assignedUser ? 'assigned_user' : 'customer';
        inMemoryDb.save();
      }
    }

    if (assignedUser && !isSuperAdmin) {
      profile.system_role = 'assigned_user';
      let stateChanged = false;
      if (assignedUser.user_id !== userId) {
        const oldUserId = assignedUser.user_id;
        assignedUser.user_id = userId;
        stateChanged = true;
        // Relink device assignments to this userId
        for (const da of inMemoryDb.deviceAssignments.values()) {
          if (
            da.assigned_user_id === oldUserId ||
            da.assigned_user_id === assignedUser.id ||
            da.assigned_user_id.toLowerCase().trim() === userEmail
          ) {
            da.assigned_user_id = userId;
            stateChanged = true;
          }
        }
      }
      if (assignedUser.status !== 'active') {
        assignedUser.status = 'active';
        stateChanged = true;
      }
      if (stateChanged) {
        inMemoryDb.save();
      }
    }

    let organizationId = decoded.organizationId;
    if (assignedUser && !isSuperAdmin) {
      organizationId = assignedUser.organization_id;
    }

    if (!organizationId) {
      for (const org of inMemoryDb.organizations.values()) {
        if (org.owner_id === profile.id) {
          organizationId = org.id;
          break;
        }
      }
      if (!organizationId) {
        organizationId = isSuperAdmin ? 'aaaa0000-0000-0000-0000-000000000001' : ('org_' + userId);
        inMemoryDb.organizations.set(organizationId, {
          id: organizationId,
          name: isSuperAdmin ? 'Vertex Global Device Farm' : `${userEmail.split('@')[0]}'s Cloud Devices`,
          slug: isSuperAdmin ? 'vertex-global' : `org-${userId.slice(0, 8)}`,
          owner_id: userId,
          plan: isSuperAdmin ? 'enterprise' : 'starter',
          max_devices: isSuperAdmin ? 100 : 5,
          max_agents: isSuperAdmin ? 50 : 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    }

    req.user = {
      id: profile.id,
      email: profile.email,
      system_role: isSuperAdmin ? 'admin' : (assignedUser ? 'assigned_user' : 'customer'),
      organizationId: organizationId,
    };

    // Cross-tenant custom domain boundary check
    const rawHost = (req.headers['x-vertex-domain'] as string) || (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
    const cleanHost = rawHost.split(':')[0].toLowerCase().trim();
    if (cleanHost) {
      const domainOrgId = resolveOrgFromHost(cleanHost);
      if (domainOrgId && !isSuperAdmin && organizationId !== domainOrgId) {
        return res.status(403).json({
          error: 'Cross-tenant domain access denied. Please access your devices through your assigned organization domain.',
        });
      }
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

export function requireRole(allowedRoles: ('admin' | 'customer' | 'assigned_user')[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthenticated.' });
    }

    if (!allowedRoles.includes(req.user.system_role)) {
      return res.status(403).json({
        error: `Access denied. Requires one of roles: [${allowedRoles.join(', ')}]`,
      });
    }

    next();
  };
}

export function enforceTenantIsolation(req: Request, res: Response, targetOrgId: string): boolean {
  if (!req.user) return false;
  
  // Platform admins can inspect any tenant
  if (req.user.system_role === 'admin') return true;

  // Strict tenant boundary: request user's org must match resource org
  return req.user.organizationId === targetOrgId;
}
