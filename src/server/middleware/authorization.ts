import type { Request, Response, NextFunction } from 'express';
import { queryOne } from '../db/db.js';

/**
 * Authorization Middleware - Ownership Enforcement
 *
 * Verifies that the authenticated user owns the resource they are trying to access.
 * - Extracts resource ID from req.params.id
 * - Queries the DB to check the resource's user_id
 * - Allows access if user_id matches req.user.sub
 * - Returns 403 Forbidden if user does not own the resource
 * - Returns 404 if the resource does not exist
 *
 * Requirements: 2.1 (restrict access to owner), 2.3 (403 on cross-user access)
 */

type ResourceType = 'item' | 'map';

const TABLE_MAP: Record<ResourceType, string> = {
  item: 'items',
  map: 'maps',
};

/**
 * Middleware factory that creates an ownership check for a given resource type.
 *
 * Usage:
 *   router.get('/api/items/:id', authenticateToken, requireOwnership('item'), handler);
 *   router.get('/api/maps/:id', authenticateToken, requireOwnership('map'), handler);
 */
export function requireOwnership(resourceType: ResourceType) {
  const tableName = TABLE_MAP[resourceType];

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const resourceId = req.params.id;

    if (!resourceId) {
      res.status(400).json({ error: 'Resource ID is required' });
      return;
    }

    if (!req.user?.sub) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      const resource = await queryOne<{ user_id: string }>(
        `SELECT user_id FROM ${tableName} WHERE id = $1`,
        [resourceId]
      );

      if (!resource) {
        res.status(404).json({ error: 'Resource not found' });
        return;
      }

      if (resource.user_id !== req.user.sub) {
        res.status(403).json({ error: 'Forbidden: You do not have access to this resource' });
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
