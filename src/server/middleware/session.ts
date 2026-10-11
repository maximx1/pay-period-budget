import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AppConfig } from "../env.ts";
import type { AppEnv } from "../http.ts";
import { AppError } from "../lib/errors.ts";
import type { AuthService } from "../services/auth.ts";

export const SESSION_COOKIE = "ppb_session";
/** Carries a token session's new expiry when using it extended it. */
export const SESSION_EXPIRES_HEADER = "X-Session-Expires";

type CookieConfig = Pick<AppConfig, "cookieSecure">;

export function setSessionCookie(c: Context, config: CookieConfig, token: string, expiresAt: Date) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "Lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

const BEARER_RE = /^Bearer +(\S+)$/i;

/**
 * The session token a request carries and how it arrived. An Authorization header wins
 * over a cookie: a client that sends one has said which session it means.
 */
export function readSessionToken(c: Context): { token: string; via: "header" | "cookie" } | null {
  const bearer = BEARER_RE.exec(c.req.header("authorization") ?? "")?.[1];
  if (bearer) return { token: bearer, via: "header" };
  const cookie = getCookie(c, SESSION_COOKIE);
  return cookie ? { token: cookie, via: "cookie" } : null;
}

/** Rejects the request with 401 unless it carries a live session; exposes the user as c.var.user. */
export function requireAuth(auth: AuthService, config: CookieConfig) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const carried = readSessionToken(c);
    const session = carried ? await auth.authenticate(carried.token) : null;
    if (!carried || !session) {
      if (carried?.via === "cookie") clearSessionCookie(c);
      throw new AppError(401, "unauthenticated", "Sign in to continue");
    }
    if (session.renewedUntil) {
      // Tell the client about the longer life the same way it was given the session.
      if (carried.via === "cookie") setSessionCookie(c, config, carried.token, session.renewedUntil);
      else c.header(SESSION_EXPIRES_HEADER, session.renewedUntil.toISOString());
    }
    c.set("user", session.user);
    c.set("sessionId", session.sessionId);
    await next();
  });
}
