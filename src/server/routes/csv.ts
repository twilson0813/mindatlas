import { Router } from 'express';
import multer from 'multer';
import type { Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { rateLimiter } from '../middleware/rateLimiter.js';
import { requireEntitlement } from '../middleware/entitlement.js';
import { importCsv, exportItems, exportMaps, getTemplate, MAX_CSV_FILE_SIZE } from '../services/csv/index.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger({ module: 'csv-route' });

/**
 * Multer configuration for CSV file uploads.
 * Uses memory storage — files are processed from buffer directly.
 * Limits file size to 10 MB (CSV import limit).
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_CSV_FILE_SIZE,
  },
  fileFilter: (_req, file, cb) => {
    // Only accept CSV files
    if (
      file.mimetype !== 'text/csv' &&
      file.mimetype !== 'application/vnd.ms-excel' &&
      !file.originalname.toLowerCase().endsWith('.csv')
    ) {
      cb(new Error('Only CSV files are accepted'));
      return;
    }
    cb(null, true);
  },
});

const router = Router();

// Apply auth, rate limiter, and entitlement check to all CSV routes
router.use(authenticateToken);
router.use(rateLimiter);
router.use(requireEntitlement('input.csv'));

/**
 * POST /api/csv/import
 * Import items from a CSV file upload.
 *
 * Expects multipart form data with a "file" field containing the CSV.
 * Returns CsvImportResult with items created, rows skipped, and skipped row numbers.
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.10
 */
router.post(
  '/import',
  (req: Request, res: Response, next) => {
    upload.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          res.status(400).json({
            error: 'CSV file exceeds the maximum size of 10 MB',
          });
          return;
        }
        res.status(400).json({ error: err.message });
        return;
      }
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }
      next();
    });
  },
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.sub;
      const file = req.file;

      if (!file) {
        res.status(400).json({ error: 'CSV file is required' });
        return;
      }

      const result = await importCsv(userId, file.buffer);

      log.info(
        { userId, itemsCreated: result.itemsCreated, rowsSkipped: result.rowsSkipped },
        'CSV import request completed'
      );

      res.status(200).json(result);
    } catch (error: unknown) {
      const err = error as Error & { statusCode?: number };
      const statusCode = err.statusCode || 500;
      log.error({ error: err.message }, 'CSV import failed');
      res.status(statusCode).json({ error: err.message });
    }
  }
);

/**
 * GET /api/csv/export/items
 * Export all user items as a CSV file download.
 *
 * Returns a CSV file with columns: content, content_type, tags, creation_date, metadata
 *
 * Requirements: 13.7, 13.9
 */
router.get('/export/items', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.sub;
    const csvBuffer = await exportItems(userId);

    log.info({ userId }, 'CSV items export request completed');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="items_export.csv"');
    res.status(200).send(csvBuffer);
  } catch (error: unknown) {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode || 500;
    log.error({ error: err.message }, 'CSV items export failed');
    res.status(statusCode).json({ error: err.message });
  }
});

/**
 * GET /api/csv/export/maps
 * Export all user map relationships as a CSV file download.
 *
 * Returns a CSV file with columns: source_item_id, target_item_id, relationship_type, confidence_score
 *
 * Requirements: 13.8, 13.9
 */
router.get('/export/maps', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.sub;
    const csvBuffer = await exportMaps(userId);

    log.info({ userId }, 'CSV maps export request completed');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="maps_export.csv"');
    res.status(200).send(csvBuffer);
  } catch (error: unknown) {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode || 500;
    log.error({ error: err.message }, 'CSV maps export failed');
    res.status(statusCode).json({ error: err.message });
  }
});

/**
 * GET /api/csv/template
 * Download a CSV template file with headers and example rows.
 *
 * Returns a CSV template demonstrating the expected format for imports.
 *
 * Requirements: 13.12, 13.13
 */
router.get('/template', (_req: Request, res: Response): void => {
  try {
    const templateBuffer = getTemplate();

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="import_template.csv"');
    res.status(200).send(templateBuffer);
  } catch (error: unknown) {
    const err = error as Error;
    log.error({ error: err.message }, 'CSV template generation failed');
    res.status(500).json({ error: err.message });
  }
});

export default router;
