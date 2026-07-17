import { Twilio } from 'twilio';
import { getTwilioCredentials } from '../credentials/index.js';
import { queryOne } from '../../db/db.js';
import { createItem } from '../items/index.js';
import { smsRetryQueue } from '../../queues.js';
import { createChildLogger } from '../../logger.js';

const log = createChildLogger({ module: 'sms-gateway' });

/**
 * SMS Gateway Service
 *
 * Processes incoming SMS messages via Twilio webhook:
 * - Verifies the sender's phone number against registered users
 * - Creates an Item from the message body if the sender is registered
 * - Sends a confirmation reply on success
 * - Discards messages from unregistered numbers with no side effects
 * - Retries failed processing up to 3 times with exponential backoff (1s, 5s, 25s)
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */

/** User row from phone lookup */
interface UserRow {
  id: string;
  email: string;
  phone_number: string;
}

/** Twilio client instance (lazy-initialized) */
let twilioClient: Twilio | null = null;

/**
 * Get or create the Twilio client instance.
 * Fetches credentials from the credential store on first initialization.
 * Allows injection for testing.
 */
export async function getTwilioClient(): Promise<Twilio> {
  if (!twilioClient) {
    const { accountSid, authToken } = await getTwilioCredentials();
    twilioClient = new Twilio(accountSid, authToken);
  }
  return twilioClient;
}

/**
 * Get the Twilio phone number from the credential store.
 */
export async function getTwilioPhoneNumber(): Promise<string> {
  const { phoneNumber } = await getTwilioCredentials();
  return phoneNumber;
}

/**
 * Set a custom Twilio client (for testing).
 */
export function setTwilioClient(client: Twilio): void {
  twilioClient = client;
}

/**
 * Reset the Twilio client to null (for testing cleanup).
 */
export function resetTwilioClient(): void {
  twilioClient = null;
}

/**
 * Verify if a phone number belongs to a registered user.
 * Returns the user if found, null otherwise.
 *
 * Requirement 4.2: Unregistered phones result in null (no action taken).
 */
export async function verifyPhoneNumber(phoneNumber: string): Promise<UserRow | null> {
  const normalizedPhone = normalizePhoneNumber(phoneNumber);

  const user = await queryOne<UserRow>(
    'SELECT id, email, phone_number FROM users WHERE phone_number = $1',
    [normalizedPhone],
  );

  return user;
}

/**
 * Normalize a phone number to E.164 format for consistent lookups.
 * Strips spaces, dashes, and ensures leading +.
 */
export function normalizePhoneNumber(phoneNumber: string): string {
  // Remove all non-digit characters except leading +
  let normalized = phoneNumber.replace(/[^\d+]/g, '');

  // Ensure it starts with +
  if (!normalized.startsWith('+')) {
    normalized = '+' + normalized;
  }

  return normalized;
}

/**
 * Send an SMS reply to the given phone number.
 * Uses Twilio to send a confirmation message.
 *
 * Requirement 4.3: Send confirmation reply on successful item creation.
 */
export async function sendReply(to: string, message: string): Promise<void> {
  const client = await getTwilioClient();
  const fromNumber = await getTwilioPhoneNumber();

  await client.messages.create({
    body: message,
    from: fromNumber,
    to,
  });

  log.info({ to }, 'SMS reply sent');
}

/**
 * Handle an incoming SMS message.
 *
 * Flow:
 * 1. Verify sender phone number against registered users
 * 2. If unregistered, discard silently (Requirement 4.2)
 * 3. If registered, create an Item from the message body (Requirement 4.1)
 * 4. Send confirmation reply (Requirement 4.3)
 *
 * On failure, the message is enqueued for retry (Requirement 4.4).
 */
export async function handleIncoming(from: string, body: string): Promise<void> {
  // Step 1: Verify sender
  const user = await verifyPhoneNumber(from);

  if (!user) {
    // Requirement 4.2: Discard with no side effects
    log.info({ from }, 'SMS from unregistered number discarded');
    return;
  }

  // Step 2: Create item from SMS body
  try {
    const item = await createItem(user.id, {
      content: body,
      content_type: 'plain_text',
      source_channel: 'sms',
    });

    // Step 3: Send confirmation reply
    await sendReply(
      from,
      `Item received and saved (ID: ${item.id}). Your note has been added to MindAtlas.`,
    );

    log.info({ userId: user.id, itemId: item.id, from }, 'SMS processed successfully');
  } catch (error) {
    log.error({ error, from, userId: user.id }, 'Failed to process SMS');
    throw error;
  }
}

/**
 * Handle an incoming SMS with retry logic.
 * On failure, enqueues the message for retry via BullMQ.
 *
 * Requirement 4.4: Log failure and retry up to 3 times.
 * Retry delays: 1s, 5s, 25s (exponential backoff).
 */
export async function handleIncomingWithRetry(from: string, body: string): Promise<void> {
  try {
    await handleIncoming(from, body);
  } catch (error) {
    log.error({ error, from }, 'SMS processing failed, enqueueing for retry');

    // Enqueue for retry via BullMQ smsRetryQueue
    await smsRetryQueue.add('sms-retry', {
      from,
      body,
      failedAt: new Date().toISOString(),
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
