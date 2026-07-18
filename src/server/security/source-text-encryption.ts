import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const FORMAT_VERSION = 1;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const HEADER_LENGTH = 1 + IV_LENGTH + AUTH_TAG_LENGTH;

type SourceTextEncryptionCode =
  | "authentication_failed"
  | "invalid_key"
  | "invalid_payload";

export class SourceTextEncryptionError extends Error {
  constructor(public readonly code: SourceTextEncryptionCode) {
    super("Source text encryption failed");
    this.name = "SourceTextEncryptionError";
  }
}

function decodeKey(base64Key: string) {
  const key = Buffer.from(base64Key, "base64");
  if (key.byteLength !== 32) {
    throw new SourceTextEncryptionError("invalid_key");
  }
  return key;
}

export function encryptSourceText(
  plaintext: string,
  base64Key: string,
  createRandomBytes: (size: number) => Buffer = randomBytes,
) {
  const key = decodeKey(base64Key);
  const iv = createRandomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([
    Buffer.from([FORMAT_VERSION]),
    iv,
    authTag,
    encrypted,
  ]);
}

export function decryptSourceText(payload: Uint8Array, base64Key: string) {
  const key = decodeKey(base64Key);
  const packed = Buffer.from(payload);
  if (packed.byteLength < HEADER_LENGTH || packed[0] !== FORMAT_VERSION) {
    throw new SourceTextEncryptionError("invalid_payload");
  }

  const iv = packed.subarray(1, 1 + IV_LENGTH);
  const authTag = packed.subarray(1 + IV_LENGTH, HEADER_LENGTH);
  const encrypted = packed.subarray(HEADER_LENGTH);

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new SourceTextEncryptionError("authentication_failed");
  }
}
