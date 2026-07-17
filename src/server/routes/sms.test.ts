import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import smsRouter from './sms.js';

// Mock the SMS service
vi.mock('../services/sms/index.js', () => ({
  handleIncomingWithRetry: vi.fn(),
  verifyPhoneNumber: vi.fn(),
}));

// Mock the logger
vi.mock('../logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { handleIncomingWithRetry } from '../services/sms/index.js';

const mockHandleIncoming = vi.mocked(handleIncomingWithRetry);

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/api/sms', smsRouter);
  return app;
}

describe('POST /api/sms/incoming', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
    mockHandleIncoming.mockResolvedValue(undefined);
  });

  it('should process incoming SMS from Twilio form-encoded payload', async () => {
    const response = await request(app).post('/api/sms/incoming').type('form').send({
      From: '+14155551234',
      Body: 'Hello MindAtlas!',
      MessageSid: 'SM_abc123',
    });

    expect(response.status).toBe(200);
    expect(response.type).toBe('text/xml');
    expect(response.text).toBe('<Response></Response>');
    expect(mockHandleIncoming).toHaveBeenCalledWith('+14155551234', 'Hello MindAtlas!');
  });

  it('should accept JSON-encoded payload too', async () => {
    const response = await request(app).post('/api/sms/incoming').send({
      From: '+14155551234',
      Body: 'JSON message',
      MessageSid: 'SM_def456',
    });

    expect(response.status).toBe(200);
    expect(mockHandleIncoming).toHaveBeenCalledWith('+14155551234', 'JSON message');
  });

  it('should return 400 when From is missing', async () => {
    const response = await request(app).post('/api/sms/incoming').type('form').send({
      Body: 'No sender',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Missing required fields');
    expect(mockHandleIncoming).not.toHaveBeenCalled();
  });

  it('should return 400 when Body is missing', async () => {
    const response = await request(app).post('/api/sms/incoming').type('form').send({
      From: '+14155551234',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Missing required fields');
    expect(mockHandleIncoming).not.toHaveBeenCalled();
  });

  it('should return 200 with TwiML even when processing throws', async () => {
    mockHandleIncoming.mockRejectedValue(new Error('Unexpected crash'));

    const response = await request(app).post('/api/sms/incoming').type('form').send({
      From: '+14155551234',
      Body: 'This will fail',
      MessageSid: 'SM_fail_123',
    });

    // Twilio expects 200 even on errors to avoid their retry mechanism
    expect(response.status).toBe(200);
    expect(response.type).toBe('text/xml');
    expect(response.text).toBe('<Response></Response>');
  });

  it('should handle empty body values as missing', async () => {
    const response = await request(app).post('/api/sms/incoming').type('form').send({
      From: '',
      Body: 'test',
    });

    expect(response.status).toBe(400);
    expect(mockHandleIncoming).not.toHaveBeenCalled();
  });
});
