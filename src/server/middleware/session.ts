import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AppConfig } from "../env.ts";
import type { AppEnv } from "../http.ts";
import { AppError } from "../lib/errors.ts";
import type { AuthService } from "../services/auth.ts";

export const SESSION_COOKIE = "ppb_session";

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

export const getSessionToken = (c: Context) => getCookie(c, SESSION_COOKIE);

/** Rejects the request with 401 unless it carries a live session; exposes the user as c.var.user. */
export function requireAuth(auth: AuthService, config: CookieConfig) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const token = getSessionToken(c);
    const session = token ? await auth.authenticate(token) : null;
    if (!token || !session) {
      if (token) clearSessionCookie(c);
      throw new AppError(401, "unauthenticated", "Sign in to continue");
    }
    if (session.renewedUntil) setSessionCookie(c, config, token, session.renewedUntil);
    c.set("user", session.user);
    c.set("sessionId", session.sessionId);
    await next();
  });
}
