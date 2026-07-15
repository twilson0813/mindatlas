import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { rateLimiter } from '../middleware/rateLimiter.js';
import {
  getUserIntegration,
  setUserIntegration,
  deleteUserIntegration,
} from '../services/credentials/index.js';

const router = Router();

// All integration routes require JWT authentication and rate limiting
router.use(authenticateToken);
router.use(rateLimiter);

// ─── n8n Integration Endpoints ───────────────────────────────────────────────

/**
 * PUT /api/integrations/n8n
 *
 * Save or update n8n integration credentials for the authenticated user.
 * Stores webhookUrl and apiKey encrypted in the user_integrations table.
 *
 * Requirements: 6.1
 *
 * Request body:
 * {
 *   "webhookUrl": "string (required)",
 *   "apiKey": "string (required)"
 * }
 *
 * Response: 200 OK with success message
 */
router.put('/n8n', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.sub;
    const { webhookUrl, apiKey } = req.body;

    if (!webhookUrl || typeof webhookUrl !== 'string') {
      res.status(400).json({ error: 'webhookUrl is required and must be a string' });
      return;
    }

    if (!apiKey || typeof apiKey !== 'string') {
      res.status(400).json({ error: 'apiKey is required and must be a string' });
      return;
    }

    await setUserIntegration(userId, 'n8n', { webhookUrl, apiKey });

    res.status(200).json({ message: 'n8n integration saved successfully' });
  } catch (error: unknown) {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message });
  }
});

/**
 * GET /api/integrations/n8n
 *
 * Retrieve n8n integration status for the authenticated user.
 * Returns the stored credentials or null if not configured.
 *
 * Requirements: 6.2, 6.3
 *
 * Response: 200 OK with integration data, or 200 with null if not configured
 */
router.get('/n8n', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.sub;
    const integration = await getUserIntegration(userId, 'n8n');

    if (!integration) {
      res.status(200).json({ integration: null });
      return;
    }

    res.status(200).json({
      integration: {
        webhookUrl: integration.credentials.webhookUrl,
        apiKey: integration.credentials.apiKey,
        metadata: integration.metadata,
      },
    });
  } catch (error: unknown) {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message });
  }
});

/**
 * DELETE /api/integrations/n8n
 *
 * Remove n8n integration for the authenticated user.
 * Deletes stored credentials from the user_integrations table.
 *
 * Requirements: 6.3
 *
 * Response: 204 No Content on success
 */
router.delete('/n8n', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.sub;
    await deleteUserIntegration(userId, 'n8n');
    res.status(204).send();
  } catch (error: unknown) {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message });
  }
});

export default router;
