import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';

// JWT secret key (in a real app, use an env variable for this)
export const JWT_SECRET = process.env.JWT_SECRET || 'SECURE_SECRET';

// Define the JWT payload structure
export interface AuthPayload {
  id: string;
  role: 'admin' | 'developer';
}

// Extend Express Request type to include our user info
declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

/** Middleware to authenticate JWT and attach user info */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn(`Auth failure: Missing or invalid Authorization header`);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.substring(7); // strip "Bearer "
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthPayload;
    req.user = { id: decoded.id, role: decoded.role };
    console.log(`Authenticated user ${decoded.id} with role ${decoded.role}`);
    next();
  } catch (err) {
    console.warn(`Auth failure: invalid token - ${err instanceof Error ? err.message : err}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

/** Middleware to enforce that the authenticated user has one of the required roles */
export function requireRole(allowedRoles: 'admin' | 'developer' | Array<'admin' | 'developer'>) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      // Not authenticated
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!roles.includes(req.user.role)) {
      console.warn(`Access denied: user ${req.user.id} with role ${req.user.role} attempted forbidden access`);
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}
