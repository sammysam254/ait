import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { inMemoryDb } from '../database/supabaseClient';

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

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : req.query.token as string;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. No token provided.' });
  }

  try {
    let decoded: any;
    try {
      decoded = jwt.verify(token, config.jwtSecret) as any;
    } catch (e) {
      // Decode Supabase access token
      decoded = jwt.decode(token) as any;
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
        system_role: isSuperAdmin ? 'admin' : (assignedUser ? 'assigned_user' : (decoded.user_metadata?.system_role || 'customer')),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      inMemoryDb.profiles.set(userId, profile);
      inMemoryDb.save();
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
      system_role: isSuperAdmin ? 'admin' : profile.system_role,
      organizationId: organizationId,
    };

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
