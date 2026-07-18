// @vitest-environment node

import { Buffer } from "node:buffer";

import { describe, expect, test } from "vitest";

import { generateAccessToken, hashAccessToken } from "./token";

describe("anonymous access tokens", () => {
  test("encodes exactly 32 bytes of entropy with URL-safe base64", () => {
    const entropy = Buffer.from(
      Array.from({ length: 32 }, (_, index) => index),
    );
    const token = generateAccessToken((size) => {
      expect(size).toBe(32);
      return entropy;
    });

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toEqual(entropy);
  });

  test("generates a fresh token for each call", () => {
    expect(generateAccessToken()).not.toBe(generateAccessToken());
  });

  test("hashes deterministically with HMAC-SHA-256 and separates keys", () => {
    const token = "safe-anonymous-token";
    const first = hashAccessToken(token, "a".repeat(32));

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(hashAccessToken(token, "a".repeat(32))).toBe(first);
    expect(hashAccessToken(token, "b".repeat(32))).not.toBe(first);
    expect(first).not.toContain(token);
  });
});
