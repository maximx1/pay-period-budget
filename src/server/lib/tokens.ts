import { createHash, randomBytes } from "node:crypto";

/** 256 bits of randomness; only its hash is stored server-side. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
