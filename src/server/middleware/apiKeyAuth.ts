import type { Request, Response, NextFunction } from 'express';
import { query } from '../db/db.js';
import {
  hashApiKey,
  findActiveKeyByHash,
  updateKeyLastUsed,
} from '../services/integrations/index.js';
import type { AuthenticatedUser } from '../types/express.js';

/**
 * API Key Authentication Middleware
 *
 * Authenticates requests using an API key passed in the "X-API-Key" header.
 * On success, attaches the same req.user shape as JWT auth, granting
 * equivalent access to the owning user's resources.
 *
 * Requirements: 9.7 (API key grants same access as session token)
 *
 * Flow:
 * 1. Extract key from X-API-Key header
 * 2. Hash the key with SHA-256
 * 3. Look up the hash in api_keys table (must be active)
 * 4. Load the user record to build the AuthenticatedUser payload
 * 5. Attach to req.user (same shape as JWT middleware produces)
 * 6. Update last_used_at timestamp
 */
export async function authenticateApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const apiKey = req.headers['x-api-key'] as string | undefined;

  if (!apiKey) {
    res.status(401).json({ error: 'API key required' });
    return;
  }

  try {
    const keyHash = hashApiKey(apiKey);
    const keyRow = await findActiveKeyByHash(keyHash);

    if (!keyRow) {
      res.status(401).json({ error: 'Invalid or revoked API key' });
      return;
    }

    // Load user to build the same req.user shape as JWT auth
    const userResult = await query<{ id: string; email: string; role: string }>(
      `SELECT id, email, role FROM users WHERE id = $1`,
      [keyRow.user_id],
    );

    const user = userResult.rows[0];
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    // Attach same shape as JWT-decoded AuthenticatedUser
    const authenticatedUser: AuthenticatedUser = {
      sub: user.id,
      email: user.email,
      role: user.role,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600, // synthetic expiry for consistency
    };

    req.user = authenticatedUser;

    // Update last_used_at asynchronously (non-blocking)
    updateKeyLastUsed(keyRow.id).catch(() => {
      // Non-critical: don't fail the request if timestamp update fails
    });

    next();
  } catch (error) {
    res.status(500).json({ error: 'Internal authentication error' });
  }
}

/**
 * Combined auth middleware that supports both JWT and API key authentication.
 * Checks for Bearer token first, then falls back to X-API-Key header.
 * This allows endpoints to accept either auth method seamlessly.
 *
 * Requirements: 9.7
 */
export async function authenticateTokenOrApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers['x-api-key'];

  if (authHeader && authHeader.startsWith('Bearer ')) {
    // Delegate to JWT auth (import inline to avoid circular deps)
    const { authenticateToken } = await import('./auth.js');
    authenticateToken(req, res, next);
    return;
  }

  if (apiKeyHeader) {
    await authenticateApiKey(req, res, next);
    return;
  }

  res.status(401).json({ error: 'Authentication required' });
}
