import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property 6: Unregistered Phone Number Rejection
 * Verify SMS from unregistered numbers creates no item and no state change.
 * Generator: random phone numbers not in the registered set.
 *
 * **Validates: Requirements 4.2**
 */

// Mock the database module — return null for all phone lookups (unregistered)
vi.mock('../../db/db.js', () => ({
  queryOne: vi.fn().mockResolvedValue(null),
}));

// Mock the items service — should never be called
vi.mock('../items/index.js', () => ({
  createItem: vi.fn(),
}));

// Mock the queues module
vi.mock('../../queues.js', () => ({
  smsRetryQueue: { add: vi.fn() },
}));

// Mock twilio
vi.mock('twilio', () => ({
  Twilio: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn(),
    },
  })),
}));

// Mock config
vi.mock('../../config.js', () => ({
  config: {
    twilioAccountSid: 'test_sid',
    twilioAuthToken: 'test_token',
    twilioPhoneNumber: '+10000000000',
  },
}));

// Mock logger
vi.mock('../../logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { handleIncoming } from './index.js';
import { createItem } from '../items/index.js';
import { queryOne } from '../../db/db.js';

const mockedCreateItem = vi.mocked(createItem);
const mockedQueryOne = vi.mocked(queryOne);

describe('Property 6: Unregistered Phone Number Rejection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure all phone lookups return null (unregistered)
    mockedQueryOne.mockResolvedValue(null);
  });

  // Generator: random E.164 phone numbers (+1XXXXXXXXXX format)
  const e164PhoneArb = fc
    .array(fc.integer({ min: 0, max: 9 }), { minLength: 10, maxLength: 10 })
    .map((digits) => `+1${digits.join('')}`);

  // Generator: random message bodies (non-empty strings)
  const messageBodyArb = fc.string({ minLength: 1, maxLength: 500 });

  it('should never call createItem for unregistered phone numbers', async () => {
    await fc.assert(
      fc.asyncProperty(e164PhoneArb, messageBodyArb, async (phoneNumber, body) => {
        // Reset mocks for each iteration
        mockedCreateItem.mockClear();
        mockedQueryOne.mockResolvedValue(null);

        await handleIncoming(phoneNumber, body);

        // createItem must NEVER be called for unregistered numbers
        expect(mockedCreateItem).not.toHaveBeenCalled();
      }),
      { numRuns: 200 },
    );
  });

  it('should never call sendReply for unregistered phone numbers', async () => {
    // We need to spy on the Twilio messages.create to verify no reply is sent
    const { Twilio } = await import('twilio');
    const mockCreate = vi.fn();
    const mockTwilioInstance = {
      messages: { create: mockCreate },
    };

    // Re-mock Twilio constructor for this test
    vi.mocked(Twilio).mockImplementation(() => mockTwilioInstance as any);

    await fc.assert(
      fc.asyncProperty(e164PhoneArb, messageBodyArb, async (phoneNumber, body) => {
        mockCreate.mockClear();
        mockedQueryOne.mockResolvedValue(null);

        await handleIncoming(phoneNumber, body);

        // No SMS reply should be sent for unregistered numbers
        expect(mockCreate).not.toHaveBeenCalled();
      }),
      { numRuns: 200 },
    );
  });

  it('should produce no state changes for any unregistered phone number and message combination', async () => {
    await fc.assert(
      fc.asyncProperty(e164PhoneArb, messageBodyArb, async (phoneNumber, body) => {
        mockedCreateItem.mockClear();
        mockedQueryOne.mockResolvedValue(null);

        // handleIncoming should complete without throwing
        await expect(handleIncoming(phoneNumber, body)).resolves.toBeUndefined();

        // Verify no item creation occurred
        expect(mockedCreateItem).not.toHaveBeenCalled();

        // Verify verifyPhoneNumber was called (it checks the DB)
        expect(mockedQueryOne).toHaveBeenCalledWith(
          expect.stringContaining('phone_number'),
          expect.arrayContaining([expect.any(String)]),
        );
      }),
      { numRuns: 200 },
    );
  });
});
