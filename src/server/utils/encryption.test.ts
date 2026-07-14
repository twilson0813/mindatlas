import { describe, it, expect, beforeEach } from 'vitest';
import {
  encrypt,
  decrypt,
  serializePayload,
  deserializePayload,
  resetKeyCache,
  EncryptedPayload,
} from './encryption';

describe('encryption utilities', () => {
  beforeEach(() => {
    resetKeyCache();
  });

  describe('encrypt and decrypt', () => {
    it('should round-trip a simple string', () => {
      const plaintext = 'Hello, MindAtlas!';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should round-trip an empty string', () => {
      const plaintext = '';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should round-trip unicode content', () => {
      const plaintext = '日本語テスト 🎉 émojis & spëcial çhàrs';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should round-trip a large string', () => {
      const plaintext = 'x'.repeat(100_000);
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertext for the same plaintext (unique IV)', () => {
      const plaintext = 'Same content encrypted twice';
      const encrypted1 = encrypt(plaintext);
      const encrypted2 = encrypt(plaintext);
      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should produce output in the expected format (3 base64 parts separated by colons)', () => {
      const encrypted = encrypt('test content');
      const parts = encrypted.split(':');
      expect(parts).toHaveLength(3);

      // Each part should be valid base64
      for (const part of parts) {
        expect(() => Buffer.from(part, 'base64')).not.toThrow();
        expect(part.length).toBeGreaterThan(0);
      }
    });

    it('should produce a 12-byte IV', () => {
      const encrypted = encrypt('test');
      const payload = deserializePayload(encrypted);
      const iv = Buffer.from(payload.iv, 'base64');
      expect(iv.length).toBe(12);
    });

    it('should produce a 16-byte auth tag', () => {
      const encrypted = encrypt('test');
      const payload = deserializePayload(encrypted);
      const authTag = Buffer.from(payload.authTag, 'base64');
      expect(authTag.length).toBe(16);
    });
  });

  describe('decrypt error handling', () => {
    it('should throw on tampered ciphertext', () => {
      const encrypted = encrypt('secret data');
      const payload = deserializePayload(encrypted);

      // Tamper with ciphertext
      const tampered: EncryptedPayload = {
        ...payload,
        ciphertext: Buffer.from('tampered-data').toString('base64'),
      };
      const serialized = serializePayload(tampered);

      expect(() => decrypt(serialized)).toThrow();
    });

    it('should throw on tampered auth tag', () => {
      const encrypted = encrypt('secret data');
      const payload = deserializePayload(encrypted);

      // Tamper with auth tag
      const tampered: EncryptedPayload = {
        ...payload,
        authTag: Buffer.alloc(16, 0xff).toString('base64'),
      };
      const serialized = serializePayload(tampered);

      expect(() => decrypt(serialized)).toThrow();
    });

    it('should throw on invalid format (wrong number of parts)', () => {
      expect(() => decrypt('only-one-part')).toThrow(/expected 3 parts/);
      expect(() => decrypt('two:parts')).toThrow(/expected 3 parts/);
      expect(() => decrypt('a:b:c:d')).toThrow(/expected 3 parts/);
    });

    it('should throw on empty IV or auth tag', () => {
      expect(() => decrypt(':authTag:ciphertext')).toThrow(/empty component/);
      expect(() => decrypt('iv::ciphertext')).toThrow(/empty component/);
    });
  });

  describe('serializePayload and deserializePayload', () => {
    it('should round-trip a payload object', () => {
      const payload: EncryptedPayload = {
        iv: 'dGVzdGl2MTIzNDU2',
        authTag: 'dGVzdGF1dGh0YWcxMjM0NQ==',
        ciphertext: 'ZW5jcnlwdGVkY29udGVudA==',
      };

      const serialized = serializePayload(payload);
      const deserialized = deserializePayload(serialized);

      expect(deserialized).toEqual(payload);
    });
  });
});
