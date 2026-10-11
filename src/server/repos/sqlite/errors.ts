import { UniqueConstraintError } from "../types.ts";

// e.g. "UNIQUE constraint failed: periods.user_id, periods.seq"
const UNIQUE_RE = /UNIQUE constraint failed: ((?:\w+\.\w+)(?:, \w+\.\w+)*)/;

const snakeToCamel = (name: string) => name.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());

/** Rethrows SQLite unique violations as UniqueConstraintError; passes anything else through. */
export function rethrowConstraint(error: unknown): never {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    const match = UNIQUE_RE.exec(e.message);
    if (match?.[1]) {
      const columns = match[1].split(", ").map((qualified) => snakeToCamel(qualified.split(".")[1]!));
      throw new UniqueConstraintError(columns.at(-1)!, columns);
    }
  }
  throw error;
}
