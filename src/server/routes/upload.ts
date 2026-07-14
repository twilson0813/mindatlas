import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import type { Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { rateLimiter } from '../middleware/rateLimiter.js';
import { createItem } from '../services/items/index.js';
import { storeFile } from '../services/storage/index.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger({ module: 'upload-route' });

/**
 * Maximum file size: 25 MB
 * Requirements: 5.3, 5.4
 */
export const MAX_FILE_SIZE = 25 * 1024 * 1024;

/**
 * Allowed file extensions and their MIME types.
 * Requirements: 5.5
 */
export const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.txt',
  '.md',
  '.csv',
  '.json',
  '.py',
  '.js',
  '.ts',
  '.html',
  '.css',
]);

/**
 * Validates whether a file extension is allowed.
 */
export function isAllowedExtension(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}

/**
 * Validates whether a file size is within the allowed limit.
 */
export function isAllowedFileSize(sizeInBytes: number): boolean {
  return sizeInBytes > 0 && sizeInBytes <= MAX_FILE_SIZE;
}

/**
 * Multer configuration with memory storage.
 * Files are held in memory buffer then stored via our storage service.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedExtension(file.originalname)) {
      cb(new Error(`File type not allowed. Allowed types: ${Array.from(ALLOWED_EXTENSIONS).join(', ')}`));
      return;
    }
    cb(null, true);
  },
});

/**
 * Creates the upload router.
 *
 * POST /api/items/upload
 * - Accepts multipart form data with optional `file` field
 * - Also accepts `content` (text), `content_type`, and `metadata` fields
 * - Must have either a file or text content
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */
export function createUploadRouter(): Router {
  const router = Router();

  router.post(
    '/upload',
    authenticateToken,
    rateLimiter,
    (req: Request, res: Response, next) => {
      upload.single('file')(req, res, (err) => {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            res.status(400).json({
              error: 'File size exceeds the 25 MB limit',
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
    async (req: Request, res: Response) => {
      try {
        const userId = req.user!.sub;
        const file = req.file;
        const content = req.body.content as string | undefined;
        const contentType = req.body.content_type as string | undefined;
        const metadataStr = req.body.metadata as string | undefined;

        // Must have either file or text content
        if (!file && (!content || content.trim().length === 0)) {
          res.status(400).json({
            error: 'Either a file upload or text content is required',
          });
          return;
        }

        // Parse metadata if provided
        let metadata: Record<string, unknown> | undefined;
        if (metadataStr) {
          try {
            metadata = JSON.parse(metadataStr);
            if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
              res.status(400).json({ error: 'Metadata must be a valid JSON object' });
              return;
            }
          } catch {
            res.status(400).json({ error: 'Metadata must be a valid JSON string' });
            return;
          }
        }

        if (file) {
          // File upload path
          // Store the file
          const stored = await storeFile(file.buffer, file.originalname, userId);

          // Read file content as text for item creation (for text-based files)
          let fileContent = file.originalname;
          const ext = path.extname(file.originalname).toLowerCase();
          const textExtensions = new Set(['.txt', '.md', '.csv', '.json', '.py', '.js', '.ts', '.html', '.css']);
          if (textExtensions.has(ext)) {
            fileContent = file.buffer.toString('utf-8');
          }

          // Create item with file info
          const item = await createItem(userId, {
            content: content || fileContent,
            content_type: (contentType as 'file') || 'file',
            title: file.originalname,
            metadata,
            source_channel: 'web_upload',
            file_path: stored.filePath,
            file_size: stored.fileSize,
          });

          log.info({ itemId: item.id, userId, fileName: file.originalname }, 'File uploaded and item created');

          res.status(201).json(item);
        } else {
          // Text-only path
          const item = await createItem(userId, {
            content: content!,
            content_type: (contentType as 'plain_text') || 'plain_text',
            metadata,
            source_channel: 'web_upload',
          });

          log.info({ itemId: item.id, userId }, 'Text item created via upload form');

          res.status(201).json(item);
        }
      } catch (error) {
        const err = error as Error & { statusCode?: number };
        const statusCode = err.statusCode || 500;
        log.error({ error: err.message }, 'Upload failed');
        res.status(statusCode).json({ error: err.message });
      }
    }
  );

  return router;
}
