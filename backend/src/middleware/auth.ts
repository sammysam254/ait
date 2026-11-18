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
    const decoded = jwt.verify(token, config.jwtSecret) as any;
    
    // Look up profile and organization
    const profile = inMemoryDb.profiles.get(decoded.id);
    if (!profile) {
      return res.status(401).json({ error: 'User profile not found or inactive.' });
    }

    // Find the primary organization for this user
    let organizationId = decoded.organizationId;
    if (!organizationId) {
      // Find org owned by user
      for (const org of inMemoryDb.organizations.values()) {
        if (org.owner_id === profile.id) {
          organizationId = org.id;
          break;
        }
      }
      // If still not found, check assigned users
      if (!organizationId) {
        for (const au of inMemoryDb.assignedUsers.values()) {
          if (au.user_id === profile.id) {
            organizationId = au.organization_id;
            break;
          }
        }
      }
    }

    req.user = {
      id: profile.id,
      email: profile.email,
      system_role: profile.system_role,
      organizationId: organizationId || '',
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
