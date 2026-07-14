import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { config } from '../config';

/**
 * AES-256-GCM encryption utilities for at-rest content encryption.
 *
 * Format: base64(iv):base64(authTag):base64(ciphertext)
 * - IV: 12 bytes, unique per encryption
 * - Auth Tag: 16 bytes (GCM authentication tag)
 * - Ciphertext: AES-256-GCM encrypted content
 */

/** Represents the components of an encrypted payload */
export interface EncryptedPayload {
  /** 12-byte initialization vector, base64-encoded */
  iv: string;
  /** 16-byte GCM authentication tag, base64-encoded */
  authTag: string;
  /** AES-256-GCM encrypted content, base64-encoded */
  ciphertext: string;
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 12 bytes for GCM
const AUTH_TAG_LENGTH = 16; // 16 bytes
const KEY_LENGTH = 32; // 256 bits
const SALT = 'mindatlas-encryption-salt'; // Static salt for key derivation

/**
 * Derives a 32-byte encryption key from the master key using scrypt.
 * If the master key is already exactly 32 bytes, it is used directly.
 */
function deriveKey(masterKey: string): Buffer {
  const keyBuffer = Buffer.from(masterKey, 'utf8');
  if (keyBuffer.length === KEY_LENGTH) {
    return keyBuffer;
  }
  return scryptSync(masterKey, SALT, KEY_LENGTH);
}

/** Cached derived key to avoid repeated key derivation */
let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (!cachedKey) {
    cachedKey = deriveKey(config.encryptionMasterKey);
  }
  return cachedKey;
}

/**
 * Resets the cached key. Useful for testing with different master keys.
 */
export function resetKeyCache(): void {
  cachedKey = null;
}

/**
 * Encrypts a plaintext string using AES-256-GCM with a unique random IV.
 *
 * @param plaintext - The string content to encrypt
 * @returns Serialized encrypted payload in format `base64(iv):base64(authTag):base64(ciphertext)`
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const payload: EncryptedPayload = {
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };

  return serializePayload(payload);
}

/**
 * Decrypts a serialized encrypted payload back to the original plaintext.
 *
 * @param encrypted - Serialized encrypted payload in format `base64(iv):base64(authTag):base64(ciphertext)`
 * @returns The original plaintext string
 * @throws Error if decryption fails (invalid key, tampered data, or malformed payload)
 */
export function decrypt(encrypted: string): string {
  const payload = deserializePayload(encrypted);
  const key = getKey();

  const iv = Buffer.from(payload.iv, 'base64');
  const authTag = Buffer.from(payload.authTag, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * Serializes an EncryptedPayload into the storage format.
 */
export function serializePayload(payload: EncryptedPayload): string {
  return `${payload.iv}:${payload.authTag}:${payload.ciphertext}`;
}

/**
 * Deserializes the storage format back into an EncryptedPayload.
 *
 * @throws Error if the format is invalid
 */
export function deserializePayload(serialized: string): EncryptedPayload {
  const parts = serialized.split(':');
  if (parts.length !== 3) {
    throw new Error(
      `Invalid encrypted payload format: expected 3 parts separated by ":", got ${parts.length}`
    );
  }

  const [iv, authTag, ciphertext] = parts;

  // IV and authTag must always be present; ciphertext can be empty (empty plaintext)
  if (!iv || !authTag) {
    throw new Error('Invalid encrypted payload format: empty component detected');
  }

  return { iv, authTag, ciphertext: ciphertext ?? '' };
}
