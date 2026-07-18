// @vitest-environment node

import { Buffer } from "node:buffer";

import { describe, expect, test } from "vitest";

import {
  SourceTextEncryptionError,
  decryptSourceText,
  encryptSourceText,
} from "./source-text-encryption";

const key = Buffer.alloc(32, 7).toString("base64");

describe("source text encryption", () => {
  test("round-trips normalized source text with AES-256-GCM", () => {
    const plaintext = "Editorial source text\n\nSecond paragraph.";
    const ciphertext = encryptSourceText(plaintext, key);

    expect(ciphertext).toBeInstanceOf(Buffer);
    expect(ciphertext.includes(Buffer.from(plaintext))).toBe(false);
    expect(decryptSourceText(ciphertext, key)).toBe(plaintext);
  });

  test("uses a fresh random IV for every encryption", () => {
    const first = encryptSourceText("same text", key);
    const second = encryptSourceText("same text", key);

    expect(first).not.toEqual(second);
    expect(decryptSourceText(first, key)).toBe("same text");
    expect(decryptSourceText(second, key)).toBe("same text");
  });

  test("rejects decryption with the wrong key", () => {
    const ciphertext = encryptSourceText("protected source", key);
    const wrongKey = Buffer.alloc(32, 8).toString("base64");

    expect(() => decryptSourceText(ciphertext, wrongKey)).toThrowError(
      SourceTextEncryptionError,
    );
  });

  test("rejects tampered authenticated ciphertext", () => {
    const ciphertext = encryptSourceText("protected source", key);
    ciphertext[ciphertext.length - 1] ^= 1;

    expect(() => decryptSourceText(ciphertext, key)).toThrowError(
      SourceTextEncryptionError,
    );
  });

  test("requires a dedicated base64-encoded 32-byte key", () => {
    expect(() => encryptSourceText("source", "not-a-key")).toThrowError(
      expect.objectContaining({
        code: "invalid_key",
      }),
    );
  });
});
