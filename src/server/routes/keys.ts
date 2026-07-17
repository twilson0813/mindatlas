import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { rateLimiter } from '../middleware/rateLimiter.js';
import { generateApiKey, revokeApiKey, listApiKeys } from '../services/integrations/index.js';

const router = Router();

// All key management routes require JWT authentication
router.use(authenticateToken);
router.use(rateLimiter);

/**
 * GET /api/keys
 *
 * List all API keys for the authenticated user.
 * Returns metadata only (id, label, is_active, last_used_at, created_at).
 * Does not return the key value or hash.
 *
 * Requirements: 9.6
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.sub;
    const keys = await listApiKeys(userId);
    res.json({ keys });
  } catch (error: unknown) {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message });
  }
});

/**
 * POST /api/keys
 *
 * Generate a new API key for the authenticated user.
 * The raw key is returned ONCE in the response — it cannot be retrieved again.
 * Only the SHA-256 hash is stored in the database.
 *
 * Request body:
 * {
 *   "label": "string (required) — human-readable name for the key"
 * }
 *
 * Response: 201 Created with { id, key, label, created_at }
 *
 * Requirements: 9.6
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.sub;
    const { label } = req.body;

    const result = await generateApiKey(userId, label);
    res.status(201).json(result);
  } catch (error: unknown) {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message });
  }
});

/**
 * DELETE /api/keys/:id
 *
 * Revoke (deactivate) an API key.
 * Only the owning user can revoke their own keys.
 * The key remains in the database but is marked inactive.
 *
 * Requirements: 9.6
 */
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.sub;
    const keyId = req.params.id as string;

    await revokeApiKey(userId, keyId);
    res.status(204).send();
  } catch (error: unknown) {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message });
  }
});

export default router;
