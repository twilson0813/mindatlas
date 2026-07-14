import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { rateLimiter } from '../middleware/rateLimiter.js';
import { requireEntitlement } from '../middleware/entitlement.js';
import {
  connectNotion,
  importFromNotion,
  exportToNotion,
  getConnection,
  disconnectNotion,
} from '../services/integrations/notion.js';

const router = Router();

// All Notion routes require JWT authentication, rate limiting, and entitlement check
router.use(authenticateToken);
router.use(rateLimiter);
router.use(requireEntitlement('integration.notion'));

/**
 * POST /api/integrations/notion/connect
 *
 * Establish an OAuth connection with Notion.
 * Accepts an authorization code from the client (obtained from Notion's OAuth consent flow),
 * exchanges it for an access token, encrypts and stores the token.
 *
 * Requirements: 9.3
 *
 * Request body:
 * {
 *   "code": "string (required) — OAuth authorization code from Notion"
 * }
 *
 * Response: 201 Created with connection details (workspace_id, workspace_name, connected_at)
 */
router.post('/connect', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.sub;
    const { code } = req.body;

    const connection = await connectNotion(userId, code);
    res.status(201).json(connection);
  } catch (error: unknown) {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message });
  }
});

/**
 * POST /api/integrations/notion/import
 *
 * Import selected Notion pages as Items.
 * Fetches content from the connected Notion workspace and creates MindAtlas items.
 *
 * Requirements: 9.4
 *
 * Request body:
 * {
 *   "page_ids": ["string"] (required) — Array of Notion page IDs to import
 * }
 *
 * Response: 200 OK with import results (items_imported count and item details)
 */
router.post('/import', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.sub;
    const { page_ids } = req.body;

    const result = await importFromNotion(userId, page_ids);
    res.json(result);
  } catch (error: unknown) {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message });
  }
});

/**
 * POST /api/integrations/notion/export
 *
 * Export Items to the connected Notion workspace.
 * Creates Notion pages from selected MindAtlas items.
 *
 * Requirements: 9.5
 *
 * Request body:
 * {
 *   "item_ids": ["string"] (required) — Array of MindAtlas item IDs to export
 * }
 *
 * Response: 200 OK with export results (pages_created count and Notion page IDs)
 */
router.post('/export', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.sub;
    const { item_ids } = req.body;

    const result = await exportToNotion(userId, item_ids);
    res.json(result);
  } catch (error: unknown) {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message });
  }
});

/**
 * GET /api/integrations/notion/status
 *
 * Get the current Notion connection status for the authenticated user.
 *
 * Response: 200 OK with connection details, or 404 if not connected
 */
router.get('/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.sub;
    const connection = await getConnection(userId);
    res.json(connection);
  } catch (error: unknown) {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message });
  }
});

/**
 * DELETE /api/integrations/notion/disconnect
 *
 * Disconnect the Notion workspace integration.
 * Removes the stored access token and connection record.
 *
 * Response: 204 No Content on success
 */
router.delete('/disconnect', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.sub;
    await disconnectNotion(userId);
    res.status(204).send();
  } catch (error: unknown) {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message });
  }
});

export default router;
