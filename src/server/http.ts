import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, MiddlewareHandler } from "hono";
import type { z } from "zod";
import type { PublicUser } from "../shared/auth.ts";
import { AppError } from "./lib/errors.ts";

export type AppEnv = {
  Variables: {
    /** Set by requireAuth and requireSession; only read it in routes behind one of them. */
    user: PublicUser;
    /** Set for a signed-in session, not for an API token; only read it behind requireSession. */
    sessionId: string;
  };
};

/** Reads and validates a JSON request body, throwing a 400 with per-field messages on failure. */
export async function parseJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  if (!c.req.header("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new AppError(415, "validation", "Expected a JSON request body");
  }
  const body: unknown = await c.req.json().catch(() => {
    throw new AppError(400, "validation", "Request body is not valid JSON");
  });
  return validated(schema, body);
}

/** Validates the query string the same way, each parameter arriving as text. */
export function parseQuery<T extends z.ZodType>(c: Context, schema: T): z.output<T> {
  return validated(schema, c.req.query());
}

function validated<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    fields[issue.path.join(".")] ??= issue.message;
  }
  throw new AppError(400, "validation", "Some fields need attention", fields);
}

export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    // A proxy appends the address it saw to whatever the visitor sent, so only the last
    // entry can be believed; the first is free for the visitor to forge.
    const forwarded = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    // No socket, e.g. when the app is driven through app.request() in tests.
    return "unknown";
  }
}

export const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence for cookie-authenticated requests: a browser always sends Origin on
 * cross-site writes, so reject any write whose Origin isn't ours. Non-browser clients
 * (which send no Origin) are unaffected.
 */
export function originGuard(allowedOrigins: string[]): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header("origin");
    if (
      !SAFE_METHODS.has(c.req.method) &&
      origin &&
      origin !== new URL(c.req.url).origin &&
      !allowedOrigins.includes(origin)
    ) {
      throw new AppError(403, "forbidden", "Cross-origin request blocked");
    }
    await next();
  };
}
