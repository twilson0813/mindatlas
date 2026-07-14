import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { isAllowedExtension, isAllowedFileSize, MAX_FILE_SIZE, ALLOWED_EXTENSIONS, createUploadRouter } from './upload.js';

/**
 * Unit tests for upload validation logic and endpoint.
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */

describe('Upload Validation', () => {
  describe('isAllowedExtension', () => {
    it('accepts PDF files', () => {
      expect(isAllowedExtension('document.pdf')).toBe(true);
    });

    it('accepts image files (PNG, JPG, JPEG, GIF)', () => {
      expect(isAllowedExtension('photo.png')).toBe(true);
      expect(isAllowedExtension('photo.jpg')).toBe(true);
      expect(isAllowedExtension('photo.jpeg')).toBe(true);
      expect(isAllowedExtension('animation.gif')).toBe(true);
    });

    it('accepts text files (TXT, MD)', () => {
      expect(isAllowedExtension('readme.txt')).toBe(true);
      expect(isAllowedExtension('notes.md')).toBe(true);
    });

    it('accepts data files (CSV, JSON)', () => {
      expect(isAllowedExtension('data.csv')).toBe(true);
      expect(isAllowedExtension('config.json')).toBe(true);
    });

    it('accepts code files (PY, JS, TS, HTML, CSS)', () => {
      expect(isAllowedExtension('script.py')).toBe(true);
      expect(isAllowedExtension('app.js')).toBe(true);
      expect(isAllowedExtension('index.ts')).toBe(true);
      expect(isAllowedExtension('page.html')).toBe(true);
      expect(isAllowedExtension('styles.css')).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(isAllowedExtension('FILE.PDF')).toBe(true);
      expect(isAllowedExtension('IMAGE.PNG')).toBe(true);
      expect(isAllowedExtension('Code.TS')).toBe(true);
    });

    it('rejects unsupported extensions', () => {
      expect(isAllowedExtension('virus.exe')).toBe(false);
      expect(isAllowedExtension('archive.zip')).toBe(false);
      expect(isAllowedExtension('binary.bin')).toBe(false);
      expect(isAllowedExtension('dynamic.dll')).toBe(false);
      expect(isAllowedExtension('shell.sh')).toBe(false);
      expect(isAllowedExtension('disk.iso')).toBe(false);
    });

    it('rejects files with no extension', () => {
      expect(isAllowedExtension('Makefile')).toBe(false);
      expect(isAllowedExtension('noext')).toBe(false);
    });
  });

  describe('isAllowedFileSize', () => {
    it('accepts files at exactly 25 MB', () => {
      expect(isAllowedFileSize(MAX_FILE_SIZE)).toBe(true);
    });

    it('accepts files under 25 MB', () => {
      expect(isAllowedFileSize(1)).toBe(true);
      expect(isAllowedFileSize(1024)).toBe(true);
      expect(isAllowedFileSize(10 * 1024 * 1024)).toBe(true);
      expect(isAllowedFileSize(MAX_FILE_SIZE - 1)).toBe(true);
    });

    it('rejects files over 25 MB', () => {
      expect(isAllowedFileSize(MAX_FILE_SIZE + 1)).toBe(false);
      expect(isAllowedFileSize(50 * 1024 * 1024)).toBe(false);
    });

    it('rejects zero-size files', () => {
      expect(isAllowedFileSize(0)).toBe(false);
    });

    it('rejects negative sizes', () => {
      expect(isAllowedFileSize(-1)).toBe(false);
    });
  });

  describe('MAX_FILE_SIZE constant', () => {
    it('is exactly 25 MB', () => {
      expect(MAX_FILE_SIZE).toBe(25 * 1024 * 1024);
    });
  });

  describe('ALLOWED_EXTENSIONS set', () => {
    it('contains all required extensions', () => {
      const required = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.txt', '.md', '.csv', '.json', '.py', '.js', '.ts', '.html', '.css'];
      for (const ext of required) {
        expect(ALLOWED_EXTENSIONS.has(ext)).toBe(true);
      }
    });
  });
});

// Integration-style tests for the upload endpoint
describe('POST /api/items/upload', () => {
  let app: express.Express;

  beforeEach(() => {
    // Mock dependencies
    vi.mock('../middleware/auth.js', () => ({
      authenticateToken: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
        req.user = { sub: 'user-123', email: 'test@example.com', role: 'user', iat: 0, exp: 0 };
        next();
      },
    }));

    vi.mock('../middleware/rateLimiter.js', () => ({
      rateLimiter: (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
        next();
      },
    }));

    vi.mock('../services/items/index.js', () => ({
      createItem: vi.fn().mockResolvedValue({
        id: 'item-1',
        user_id: 'user-123',
        title: null,
        content: 'test content',
        content_type: 'plain_text',
        metadata: null,
        source_channel: 'web_upload',
        source_domain: null,
        file_path: null,
        file_size: null,
        is_deleted: false,
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      }),
    }));

    vi.mock('../services/storage/index.js', () => ({
      storeFile: vi.fn().mockResolvedValue({
        filePath: 'user-123/1234-abcd.txt',
        absolutePath: '/uploads/user-123/1234-abcd.txt',
        fileSize: 100,
      }),
    }));

    vi.mock('../logger.js', () => ({
      createChildLogger: () => ({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      }),
    }));

    app = express();
    app.use('/api/items', createUploadRouter());
  });

  it('returns 400 when neither file nor content is provided', async () => {
    const res = await request(app)
      .post('/api/items/upload')
      .field('content', '');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Either a file upload or text content is required');
  });

  it('accepts text-only submission without a file (Req 5.6)', async () => {
    const res = await request(app)
      .post('/api/items/upload')
      .field('content', 'Hello, world!');

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('item-1');
  });

  it('accepts a valid file upload', async () => {
    const res = await request(app)
      .post('/api/items/upload')
      .attach('file', Buffer.from('file content'), 'test.txt');

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('item-1');
  });

  it('rejects files with unsupported extensions', async () => {
    const res = await request(app)
      .post('/api/items/upload')
      .attach('file', Buffer.from('binary'), 'malware.exe');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('File type not allowed');
  });

  it('returns 400 for invalid metadata JSON', async () => {
    const res = await request(app)
      .post('/api/items/upload')
      .field('content', 'test')
      .field('metadata', 'not-valid-json');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Metadata must be a valid JSON string');
  });

  it('accepts valid metadata JSON', async () => {
    const res = await request(app)
      .post('/api/items/upload')
      .field('content', 'test content')
      .field('metadata', JSON.stringify({ tags: ['important'] }));

    expect(res.status).toBe(201);
  });
});
