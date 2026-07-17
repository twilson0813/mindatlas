import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { rateLimiter } from '../middleware/rateLimiter.js';
import { validateItemCreation, handleValidationErrors } from '../middleware/validation.js';
import {
  createItem,
  getItem,
  listItems,
  deleteItem,
  getItemRelationships,
} from '../services/items/index.js';
import type { ItemFilters } from '../services/items/index.js';

const router = Router();

// Apply auth and rate limiter to all item routes
router.use(authenticateToken);
router.use(rateLimiter);

/**
 * POST /api/items
 * Create a new item.
 * Validates input using express-validator chain, then creates item scoped to authenticated user.
 *
 * Requirements: 3.1, 3.2, 3.3
 */
router.post(
  '/',
  validateItemCreation,
  handleValidationErrors,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.sub;
      const item = await createItem(userId, {
        content: req.body.content,
        content_type: req.body.content_type,
        title: req.body.title,
        metadata: req.body.metadata,
        source_channel: req.body.source_channel || 'api',
        source_domain: req.body.source_domain,
      });

      res.status(201).json(item);
    } catch (error: unknown) {
      const err = error as Error & { statusCode?: number };
      const statusCode = err.statusCode || 500;
      res.status(statusCode).json({ error: err.message });
    }
  },
);

/**
 * GET /api/items
 * List items with optional filter query parameters.
 * Supports: category, tag, date_from, date_to, keyword, page, page_size
 *
 * Requirements: 3.1, 8.5
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.sub;
    const filters: ItemFilters = {
      category: req.query.category as string | undefined,
      tag: req.query.tag as string | undefined,
      date_from: req.query.date_from as string | undefined,
      date_to: req.query.date_to as string | undefined,
      keyword: req.query.keyword as string | undefined,
      page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
      page_size: req.query.page_size ? parseInt(req.query.page_size as string, 10) : undefined,
    };

    const result = await listItems(userId, filters);
    res.json(result);
  } catch (error: unknown) {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message });
  }
});

/**
 * GET /api/items/:id
 * Get a single item by ID.
 * Returns 404 if not found, 403 if owned by another user.
 *
 * Requirements: 3.1
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.sub;
    const itemId = req.params.id as string;
    const item = await getItem(userId, itemId);
    res.json(item);
  } catch (error: unknown) {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message });
  }
});

/**
 * DELETE /api/items/:id
 * Soft-delete an item by ID.
 * Returns 404 if not found, 403 if owned by another user.
 *
 * Requirements: 3.1, 12.4
 */
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.sub;
    const itemId = req.params.id as string;
    await deleteItem(userId, itemId);
    res.status(204).send();
  } catch (error: unknown) {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message });
  }
});

/**
 * GET /api/items/:id/relationships
 * Get relationships for an item.
 * Returns 404 if item not found or not owned by user.
 *
 * Requirements: 6.2
 */
router.get('/:id/relationships', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.sub;
    const itemId = req.params.id as string;
    const relationships = await getItemRelationships(userId, itemId);
    res.json(relationships);
  } catch (error: unknown) {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message });
  }
});

export default router;
