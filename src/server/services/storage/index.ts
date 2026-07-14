import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { createChildLogger } from '../../logger.js';

const log = createChildLogger({ module: 'storage-service' });

/**
 * Storage Service
 *
 * Provides a simple file storage abstraction that stores files locally
 * in an `uploads/` directory. This can be swapped to S3/MinIO later
 * by changing the implementation without affecting callers.
 */

const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');

export interface StoredFile {
  /** Path relative to storage root (used as file_path in DB) */
  filePath: string;
  /** Absolute path on disk */
  absolutePath: string;
  /** File size in bytes */
  fileSize: number;
}

/**
 * Ensures the uploads directory exists.
 */
async function ensureUploadsDir(): Promise<void> {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
}

/**
 * Stores a file buffer to the local uploads directory.
 * Generates a unique filename to avoid collisions.
 *
 * @param buffer - The file content buffer
 * @param originalFilename - The original filename (used for extension)
 * @param userId - The user who owns the file (used for directory scoping)
 * @returns StoredFile with path information
 */
export async function storeFile(
  buffer: Buffer,
  originalFilename: string,
  userId: string
): Promise<StoredFile> {
  await ensureUploadsDir();

  // Create user-scoped subdirectory
  const userDir = path.join(UPLOADS_DIR, userId);
  await fs.mkdir(userDir, { recursive: true });

  // Generate unique filename preserving extension
  const ext = path.extname(originalFilename);
  const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  const absolutePath = path.join(userDir, uniqueName);

  // Write file
  await fs.writeFile(absolutePath, buffer);

  // Relative path for DB storage
  const filePath = path.join(userId, uniqueName);

  log.info({ filePath, fileSize: buffer.length, userId }, 'File stored successfully');

  return {
    filePath,
    absolutePath,
    fileSize: buffer.length,
  };
}

/**
 * Retrieves a file from storage.
 *
 * @param filePath - The relative file path (as stored in DB)
 * @returns The file buffer
 */
export async function getFile(filePath: string): Promise<Buffer> {
  const absolutePath = path.join(UPLOADS_DIR, filePath);
  return fs.readFile(absolutePath);
}

/**
 * Deletes a file from storage.
 *
 * @param filePath - The relative file path (as stored in DB)
 */
export async function deleteFile(filePath: string): Promise<void> {
  const absolutePath = path.join(UPLOADS_DIR, filePath);
  try {
    await fs.unlink(absolutePath);
    log.info({ filePath }, 'File deleted from storage');
  } catch (error) {
    log.warn({ filePath, error }, 'Failed to delete file from storage');
  }
}
