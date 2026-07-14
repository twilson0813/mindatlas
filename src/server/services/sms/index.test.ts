import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handleIncoming,
  handleIncomingWithRetry,
  verifyPhoneNumber,
  sendReply,
  normalizePhoneNumber,
  setTwilioClient,
  resetTwilioClient,
} from './index.js';

// Mock the database module
vi.mock('../../db/db.js', () => ({
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  query: vi.fn(),
}));

// Mock the items service
vi.mock('../items/index.js', () => ({
  createItem: vi.fn(),
}));

// Mock the queues
vi.mock('../../queues.js', () => ({
  smsRetryQueue: {
    add: vi.fn(),
  },
  aiProcessingQueue: {
    add: vi.fn(),
  },
}));

// Mock the logger
vi.mock('../../logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock the config
vi.mock('../../config.js', () => ({
  config: {
    twilioAccountSid: 'test-sid',
    twilioAuthToken: 'test-auth-token',
    twilioPhoneNumber: '+15551234567',
  },
}));

import { queryOne } from '../../db/db.js';
import { createItem } from '../items/index.js';
import { smsRetryQueue } from '../../queues.js';

const mockQueryOne = vi.mocked(queryOne);
const mockCreateItem = vi.mocked(createItem);
const mockSmsRetryQueue = vi.mocked(smsRetryQueue);

describe('SMS Gateway Service', () => {
  let mockTwilioClient: { messages: { create: ReturnType<typeof vi.fn> } };

  beforeEach(() => {
    vi.clearAllMocks();
    mockTwilioClient = {
      messages: {
        create: vi.fn().mockResolvedValue({ sid: 'SM_test_123' }),
      },
    };
    setTwilioClient(mockTwilioClient as unknown as import('twilio').Twilio);
  });

  afterEach(() => {
    resetTwilioClient();
  });

  describe('normalizePhoneNumber', () => {
    it('should pass through E.164 numbers unchanged', () => {
      expect(normalizePhoneNumber('+14155551234')).toBe('+14155551234');
    });

    it('should add leading + if missing', () => {
      expect(normalizePhoneNumber('14155551234')).toBe('+14155551234');
    });

    it('should strip spaces and dashes', () => {
      expect(normalizePhoneNumber('+1 415-555-1234')).toBe('+14155551234');
    });

    it('should strip parentheses', () => {
      expect(normalizePhoneNumber('+1 (415) 555-1234')).toBe('+14155551234');
    });
  });

  describe('verifyPhoneNumber', () => {
    it('should return user when phone number is registered', async () => {
      const mockUser = { id: 'user-123', email: 'test@example.com', phone_number: '+14155551234' };
      mockQueryOne.mockResolvedValue(mockUser);

      const result = await verifyPhoneNumber('+14155551234');

      expect(result).toEqual(mockUser);
      expect(mockQueryOne).toHaveBeenCalledWith(
        'SELECT id, email, phone_number FROM "user" WHERE phone_number = $1',
        ['+14155551234']
      );
    });

    it('should return null when phone number is not registered', async () => {
      mockQueryOne.mockResolvedValue(null);

      const result = await verifyPhoneNumber('+19995559999');

      expect(result).toBeNull();
    });

    it('should normalize phone number before lookup', async () => {
      mockQueryOne.mockResolvedValue(null);

      await verifyPhoneNumber('1-415-555-1234');

      expect(mockQueryOne).toHaveBeenCalledWith(
        'SELECT id, email, phone_number FROM "user" WHERE phone_number = $1',
        ['+14155551234']
      );
    });
  });

  describe('sendReply', () => {
    it('should send SMS via Twilio client', async () => {
      await sendReply('+14155551234', 'Item saved!');

      expect(mockTwilioClient.messages.create).toHaveBeenCalledWith({
        body: 'Item saved!',
        from: '+15551234567',
        to: '+14155551234',
      });
    });

    it('should propagate Twilio errors', async () => {
      mockTwilioClient.messages.create.mockRejectedValue(new Error('Twilio error'));

      await expect(sendReply('+14155551234', 'test')).rejects.toThrow('Twilio error');
    });
  });

  describe('handleIncoming', () => {
    it('should discard messages from unregistered numbers with no side effects', async () => {
      mockQueryOne.mockResolvedValue(null);

      await handleIncoming('+19995559999', 'Hello from unknown');

      expect(mockCreateItem).not.toHaveBeenCalled();
      expect(mockTwilioClient.messages.create).not.toHaveBeenCalled();
    });

    it('should create an item for registered user', async () => {
      const mockUser = { id: 'user-456', email: 'user@test.com', phone_number: '+14155551234' };
      mockQueryOne.mockResolvedValue(mockUser);
      mockCreateItem.mockResolvedValue({
        id: 'item-789',
        user_id: 'user-456',
        title: null,
        content: 'My SMS note',
        content_type: 'plain_text',
        metadata: null,
        source_channel: 'sms',
        source_domain: null,
        file_path: null,
        file_size: null,
        is_deleted: false,
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      await handleIncoming('+14155551234', 'My SMS note');

      expect(mockCreateItem).toHaveBeenCalledWith('user-456', {
        content: 'My SMS note',
        content_type: 'plain_text',
        source_channel: 'sms',
      });
    });

    it('should send confirmation reply after creating item', async () => {
      const mockUser = { id: 'user-456', email: 'user@test.com', phone_number: '+14155551234' };
      mockQueryOne.mockResolvedValue(mockUser);
      mockCreateItem.mockResolvedValue({
        id: 'item-789',
        user_id: 'user-456',
        title: null,
        content: 'My note',
        content_type: 'plain_text',
        metadata: null,
        source_channel: 'sms',
        source_domain: null,
        file_path: null,
        file_size: null,
        is_deleted: false,
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      await handleIncoming('+14155551234', 'My note');

      expect(mockTwilioClient.messages.create).toHaveBeenCalledWith({
        body: expect.stringContaining('item-789'),
        from: '+15551234567',
        to: '+14155551234',
      });
    });

    it('should throw error when createItem fails', async () => {
      const mockUser = { id: 'user-456', email: 'user@test.com', phone_number: '+14155551234' };
      mockQueryOne.mockResolvedValue(mockUser);
      mockCreateItem.mockRejectedValue(new Error('DB error'));

      await expect(handleIncoming('+14155551234', 'Some text')).rejects.toThrow('DB error');
    });
  });

  describe('handleIncomingWithRetry', () => {
    it('should process successfully without enqueueing retry', async () => {
      mockQueryOne.mockResolvedValue(null); // unregistered - discards silently

      await handleIncomingWithRetry('+19995559999', 'Hello');

      expect(mockSmsRetryQueue.add).not.toHaveBeenCalled();
    });

    it('should enqueue for retry when processing fails', async () => {
      const mockUser = { id: 'user-456', email: 'user@test.com', phone_number: '+14155551234' };
      mockQueryOne.mockResolvedValue(mockUser);
      mockCreateItem.mockRejectedValue(new Error('Database connection lost'));

      await handleIncomingWithRetry('+14155551234', 'Important note');

      expect(mockSmsRetryQueue.add).toHaveBeenCalledWith('sms-retry', {
        from: '+14155551234',
        body: 'Important note',
        failedAt: expect.any(String),
        errorMessage: 'Database connection lost',
      });
    });

    it('should not throw even when processing fails', async () => {
      const mockUser = { id: 'user-456', email: 'user@test.com', phone_number: '+14155551234' };
      mockQueryOne.mockResolvedValue(mockUser);
      mockCreateItem.mockRejectedValue(new Error('Something broke'));

      // Should NOT throw — error is caught and enqueued
      await expect(handleIncomingWithRetry('+14155551234', 'Note')).resolves.toBeUndefined();
    });
  });
});
