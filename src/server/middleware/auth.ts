import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import type { AuthenticatedUser } from '../types/express.js';

/**
 * Auth Middleware
 *
 * Validates JWT access tokens on protected routes.
 * - Extracts token from "Authorization: Bearer <token>" header
 * - Verifies signature and expiry using jwtSecret from config
 * - Attaches decoded payload to req.user on success
 * - Returns 401 for missing, invalid, or expired tokens
 *
 * Requirements: 1.4 (session token expiry), 2.2 (unauthenticated rejection)
 */
export function authenticateToken(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const token = authHeader.slice(7); // Remove "Bearer " prefix

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as AuthenticatedUser;
    req.user = decoded;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
