import { Router } from 'express';
import type { Request, Response } from 'express';
import { createChildLogger } from '../logger.js';
import { handleIncomingWithRetry, verifyPhoneNumber } from '../services/sms/index.js';

const log = createChildLogger({ module: 'sms-route' });

const router = Router();

/**
 * POST /api/sms/incoming
 * Twilio SMS webhook endpoint.
 *
 * Twilio sends incoming SMS data as form-urlencoded with fields:
 * - From: sender phone number (E.164 format)
 * - Body: message text content
 * - MessageSid: unique Twilio message ID
 *
 * This endpoint:
 * 1. Extracts the sender and body from the Twilio payload
 * 2. Processes the message (verify phone, create item, send reply)
 * 3. Returns TwiML-compatible empty response
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */
router.post('/incoming', async (req: Request, res: Response): Promise<void> => {
  try {
    const from = req.body.From as string;
    const body = req.body.Body as string;
    const messageSid = req.body.MessageSid as string | undefined;

    if (!from || !body) {
      log.warn({ from, body }, 'Incomplete SMS webhook payload');
      res.status(400).json({ error: 'Missing required fields: From, Body' });
      return;
    }

    log.info({ from, messageSid, bodyLength: body.length }, 'Incoming SMS received');

    // Process asynchronously — respond to Twilio immediately to avoid timeout
    // The retry logic is handled internally by handleIncomingWithRetry
    await handleIncomingWithRetry(from, body);

    // Return empty TwiML response (Twilio expects XML or empty 200)
    res.status(200).type('text/xml').send('<Response></Response>');
  } catch (error) {
    log.error({ error }, 'Unexpected error in SMS webhook');
    // Still respond to Twilio to avoid retries at their level
    res.status(200).type('text/xml').send('<Response></Response>');
  }
});

export default router;
