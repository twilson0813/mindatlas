import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateApiKey } from '../middleware/apiKeyAuth.js';
import { requireEntitlement } from '../middleware/entitlement.js';
import { handleWebhook } from '../services/integrations/index.js';

const router = Router();

/**
 * POST /api/webhooks/n8n
 *
 * Accepts incoming webhook payloads from n8n workflow automations.
 * Requires API key authentication via X-API-Key header.
 * Creates an Item from the payload content for the authenticated user.
 *
 * Requirements: 9.1, 9.2
 *
 * Request body:
 * {
 *   "content": "string (required)",
 *   "content_type": "string (optional, defaults to plain_text)",
 *   "title": "string (optional)",
 *   "metadata": { ... } (optional),
 *   "source_domain": "string (optional, defaults to 'n8n')"
 * }
 *
 * Response: 201 Created with the created Item
 */
router.post(
  '/n8n',
  authenticateApiKey,
  requireEntitlement('integration.n8n'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.sub;
      const item = await handleWebhook(userId, req.body);
      res.status(201).json(item);
    } catch (error: unknown) {
      const err = error as Error & { statusCode?: number };
      const statusCode = err.statusCode || 500;
      res.status(statusCode).json({ error: err.message });
    }
  },
);

export default router;
