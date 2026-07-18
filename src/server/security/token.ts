import { createHmac, randomBytes } from "node:crypto";

type RandomBytes = (size: number) => Buffer;

export function generateAccessToken(
  createRandomBytes: RandomBytes = randomBytes,
) {
  return createRandomBytes(32).toString("base64url");
}

export function hashAccessToken(token: string, secret: string) {
  return createHmac("sha256", secret).update(token, "utf8").digest("hex");
}
