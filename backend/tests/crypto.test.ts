import { describe, it, expect, beforeAll } from "bun:test";
import { randomBytes } from "node:crypto";

// Provide a valid 32-byte base64 key for the crypto module before importing it.
// The module reads process.env.ENCRYPTION_KEY lazily (on first encrypt/decrypt),
// so setting it here is sufficient.
beforeAll(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

import { encrypt, decrypt } from "../utils/crypto";

describe("crypto AES-256-GCM", () => {
  it("round-trips plaintext through encrypt -> decrypt", () => {
    const plaintext = "sk-test-1234567890abcdef";
    const blob = encrypt(plaintext);
    expect(blob).not.toContain(plaintext); // ciphertext, not plaintext
    expect(decrypt(blob)).toBe(plaintext);
  });

  it("produces a different blob each time (random IV) but decrypts the same", () => {
    const plaintext = "same-secret";
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(plaintext);
    expect(decrypt(b)).toBe(plaintext);
  });

  it("throws when the auth tag is tampered with", () => {
    const blob = encrypt("tamper-me");
    const [iv, authTag, ciphertext] = blob.split(".");
    // Flip the auth tag to a different valid-length base64 value.
    const badTag = Buffer.from(authTag!, "base64");
    badTag[0] = badTag[0]! ^ 0xff;
    const tampered = [iv, badTag.toString("base64"), ciphertext].join(".");
    expect(() => decrypt(tampered)).toThrow();
  });

  it("throws when the ciphertext is tampered with", () => {
    const blob = encrypt("tamper-cipher");
    const [iv, authTag, ciphertext] = blob.split(".");
    const badCipher = Buffer.from(ciphertext!, "base64");
    badCipher[0] = badCipher[0]! ^ 0xff;
    const tampered = [iv, authTag, badCipher.toString("base64")].join(".");
    expect(() => decrypt(tampered)).toThrow();
  });

  it("throws on a wrong-length ENCRYPTION_KEY", () => {
    const original = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = randomBytes(16).toString("base64"); // 16 bytes, not 32
    try {
      expect(() => encrypt("anything")).toThrow();
    } finally {
      process.env.ENCRYPTION_KEY = original;
    }
  });
});
