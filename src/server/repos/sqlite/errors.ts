import { UniqueConstraintError } from "../types.ts";

const UNIQUE_RE = /UNIQUE constraint failed: \w+\.(\w+)/;

const snakeToCamel = (name: string) => name.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());

/** Rethrows SQLite unique violations as UniqueConstraintError(field); passes anything else through. */
export function rethrowConstraint(error: unknown): never {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    const match = UNIQUE_RE.exec(e.message);
    if (match?.[1]) throw new UniqueConstraintError(snakeToCamel(match[1]));
  }
  throw error;
}
