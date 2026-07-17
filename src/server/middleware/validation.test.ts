import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  validateEmail,
  validatePassword,
  validateTextContent,
  validateContentType,
  validateItemCreation,
  validateRegistration,
  handleValidationErrors,
  VALID_CONTENT_TYPES,
} from './validation.js';

// Helper to create a minimal Express app with validation middleware
function createTestApp(validationChain: unknown[]) {
  const app = express();
  app.use(express.json());
  app.post(
    '/test',
    ...(validationChain as express.RequestHandler[]),
    handleValidationErrors,
    (_req, res) => {
      res.status(200).json({ success: true, body: _req.body });
    },
  );
  return app;
}

describe('validateEmail', () => {
  const app = createTestApp(validateEmail);

  it('accepts a valid email', async () => {
    const res = await request(app).post('/test').send({ email: 'user@example.com' });
    expect(res.status).toBe(200);
  });

  it('rejects empty email', async () => {
    const res = await request(app).post('/test').send({ email: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('rejects invalid email format', async () => {
    const res = await request(app).post('/test').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: 'Must be a valid email address' }),
      ]),
    );
  });

  it('normalizes email', async () => {
    const res = await request(app).post('/test').send({ email: '  User@EXAMPLE.com  ' });
    expect(res.status).toBe(200);
    expect(res.body.body.email).toBe('user@example.com');
  });
});

describe('validatePassword', () => {
  const app = createTestApp(validatePassword);

  it('accepts a strong password', async () => {
    const res = await request(app).post('/test').send({ password: 'MyP@ss1!' });
    expect(res.status).toBe(200);
  });

  it('rejects empty password', async () => {
    const res = await request(app).post('/test').send({ password: '' });
    expect(res.status).toBe(400);
  });

  it('rejects password shorter than 8 chars', async () => {
    const res = await request(app).post('/test').send({ password: 'Ab1!' });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'Password must be at least 8 characters long',
        }),
      ]),
    );
  });

  it('rejects password without uppercase', async () => {
    const res = await request(app).post('/test').send({ password: 'mypass1!' });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'Password must contain at least one uppercase letter',
        }),
      ]),
    );
  });

  it('rejects password without lowercase', async () => {
    const res = await request(app).post('/test').send({ password: 'MYPASS1!' });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'Password must contain at least one lowercase letter',
        }),
      ]),
    );
  });

  it('rejects password without digit', async () => {
    const res = await request(app).post('/test').send({ password: 'MyPasss!' });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'Password must contain at least one digit',
        }),
      ]),
    );
  });

  it('rejects password without special character', async () => {
    const res = await request(app).post('/test').send({ password: 'MyPass12' });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'Password must contain at least one special character',
        }),
      ]),
    );
  });
});

describe('validateTextContent', () => {
  const app = createTestApp(validateTextContent);

  it('accepts valid text content', async () => {
    const res = await request(app).post('/test').send({ content: 'Hello, world!' });
    expect(res.status).toBe(200);
  });

  it('rejects empty content', async () => {
    const res = await request(app).post('/test').send({ content: '' });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: 'Content is required' })]),
    );
  });

  it('sanitizes HTML from content', async () => {
    const res = await request(app)
      .post('/test')
      .send({ content: '<script>alert("xss")</script>Safe text' });
    expect(res.status).toBe(200);
    expect(res.body.body.content).toBe('Safe text');
  });

  it('rejects content exceeding max length', async () => {
    const longContent = 'a'.repeat(50001);
    const res = await request(app).post('/test').send({ content: longContent });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'Content must not exceed 50000 characters',
        }),
      ]),
    );
  });
});

describe('validateContentType', () => {
  const app = createTestApp(validateContentType);

  it('accepts valid content types', async () => {
    for (const type of VALID_CONTENT_TYPES) {
      const res = await request(app).post('/test').send({ content_type: type });
      expect(res.status).toBe(200);
    }
  });

  it('accepts missing content_type (optional)', async () => {
    const res = await request(app).post('/test').send({});
    expect(res.status).toBe(200);
  });

  it('rejects invalid content type', async () => {
    const res = await request(app).post('/test').send({ content_type: 'invalid_type' });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('Content type must be one of'),
        }),
      ]),
    );
  });
});

describe('validateItemCreation', () => {
  const app = createTestApp(validateItemCreation);

  it('accepts valid item with content and content_type', async () => {
    const res = await request(app).post('/test').send({ content: 'My note', content_type: 'note' });
    expect(res.status).toBe(200);
  });

  it('accepts valid item with only content', async () => {
    const res = await request(app).post('/test').send({ content: 'My note' });
    expect(res.status).toBe(200);
  });

  it('accepts valid item with metadata object', async () => {
    const res = await request(app)
      .post('/test')
      .send({ content: 'My note', metadata: { tags: ['test'] } });
    expect(res.status).toBe(200);
  });

  it('rejects item with non-object metadata', async () => {
    const res = await request(app)
      .post('/test')
      .send({ content: 'My note', metadata: 'not an object' });
    expect(res.status).toBe(400);
  });

  it('sanitizes content HTML in item creation', async () => {
    const res = await request(app)
      .post('/test')
      .send({ content: '<img onerror="alert(1)" src="x">Hello' });
    expect(res.status).toBe(200);
    expect(res.body.body.content).not.toContain('onerror');
    expect(res.body.body.content).not.toContain('<img');
  });
});

describe('validateRegistration', () => {
  const app = createTestApp(validateRegistration);

  it('accepts valid email and password', async () => {
    const res = await request(app)
      .post('/test')
      .send({ email: 'user@example.com', password: 'MyP@ss1!' });
    expect(res.status).toBe(200);
  });

  it('rejects invalid email with valid password', async () => {
    const res = await request(app).post('/test').send({ email: 'invalid', password: 'MyP@ss1!' });
    expect(res.status).toBe(400);
  });

  it('rejects valid email with weak password', async () => {
    const res = await request(app)
      .post('/test')
      .send({ email: 'user@example.com', password: 'weak' });
    expect(res.status).toBe(400);
  });
});
