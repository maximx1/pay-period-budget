import { createHash, randomBytes } from "node:crypto";

/** 256 bits of randomness; only its hash is stored server-side. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

const API_TOKEN_PREFIX = "ppb_";

/** As strong as a session token, with a prefix that makes a leaked one recognisable. */
export function generateApiToken(): string {
  return API_TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

/** Whether a bearer token has the shape of an API token. A session token can, very rarely, start the same way. */
export function looksLikeApiToken(token: string): boolean {
  return token.startsWith(API_TOKEN_PREFIX);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
