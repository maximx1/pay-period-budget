import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, MiddlewareHandler } from "hono";
import type { z } from "zod";
import type { PublicUser } from "../shared/auth.ts";
import { AppError } from "./lib/errors.ts";

export type AppEnv = {
  Variables: {
    /** Set by requireAuth; only read it in routes behind that middleware. */
    user: PublicUser;
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
  const result = schema.safeParse(body);
  if (result.success) return result.data;

  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    fields[issue.path.join(".")] ??= issue.message;
  }
  throw new AppError(400, "validation", "Some fields need attention", fields);
}

export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    // No socket, e.g. when the app is driven through app.request() in tests.
    return "unknown";
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

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
