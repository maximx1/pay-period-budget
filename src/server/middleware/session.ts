import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AppConfig } from "../env.ts";
import { type AppEnv, SAFE_METHODS } from "../http.ts";
import { AppError } from "../lib/errors.ts";
import { looksLikeApiToken } from "../lib/tokens.ts";
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

function authenticate(auth: AuthService, config: CookieConfig, accept: { apiTokens: boolean }) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const carried = readSessionToken(c);

    if (carried?.via === "header" && looksLikeApiToken(carried.token)) {
      const apiToken = await auth.authenticateApiToken(carried.token);
      // An unknown one falls through: it is refused below like any other bad credential.
      if (apiToken) {
        if (!accept.apiTokens) {
          throw new AppError(403, "forbidden", "An API token can't manage the account. Sign in to do that.");
        }
        if (apiToken.scope === "read" && !SAFE_METHODS.has(c.req.method)) {
          throw new AppError(403, "forbidden", "This API token is read-only");
        }
        c.set("user", apiToken.user);
        await next();
        return;
      }
    }

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

/**
 * Rejects the request with 401 unless it carries a live session or API token; exposes the
 * user as c.var.user. A read-only token is refused (403) on anything but a read. For
 * budget data; anything that manages the account takes requireSession instead.
 */
export function requireAuth(auth: AuthService, config: CookieConfig) {
  return authenticate(auth, config, { apiTokens: true });
}

/**
 * As requireAuth, but only a signed-in session will do: an API token gets a 403. A leaked
 * token must not be able to change the password, sign devices out or mint another token.
 */
export function requireSession(auth: AuthService, config: CookieConfig) {
  return authenticate(auth, config, { apiTokens: false });
}
