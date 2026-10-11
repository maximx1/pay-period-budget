import { hash, verify } from "@node-rs/argon2";

// Argon2id (the library default algorithm) with the OWASP-recommended minimum parameters.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/** Spends the same time as a real verification so unknown accounts can't be told apart by timing. */
export async function verifyDummyPassword(password: string): Promise<void> {
  dummyHash ??= hashPassword("not-a-real-password");
  await verifyPassword(await dummyHash, password);
}
