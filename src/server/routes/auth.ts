import { Hono } from "hono";
import {
  type AuthResponse,
  changePasswordSchema,
  loginInputSchema,
  registerInputSchema,
  type SessionListResponse,
} from "../../shared/auth.ts";
import type { AppConfig } from "../env.ts";
import { type AppEnv, clientIp, parseJson } from "../http.ts";
import { AppError } from "../lib/errors.ts";
import { RateLimiter } from "../lib/rateLimit.ts";
import {
  clearSessionCookie,
  getSessionToken,
  requireAuth,
  setSessionCookie,
} from "../middleware/session.ts";
import type { AuthService } from "../services/auth.ts";

const MINUTE = 60 * 1000;

const tooManyAttempts = (retryAfterSeconds: number) =>
  new AppError(429, "rate_limited", "Too many attempts. Try again later.", undefined, {
    "Retry-After": String(retryAfterSeconds),
  });

export function authRoutes(deps: { auth: AuthService; config: AppConfig; now?: () => Date }) {
  const { auth, config } = deps;
  const clock = () => (deps.now?.() ?? new Date()).getTime();

  // Failed sign-ins are counted per account and per address; registrations per address.
  const loginByIdentifier = new RateLimiter(10, 15 * MINUTE, clock);
  const loginByIp = new RateLimiter(50, 15 * MINUTE, clock);
  const registerByIp = new RateLimiter(10, 60 * MINUTE, clock);
  const passwordByUser = new RateLimiter(10, 15 * MINUTE, clock);
  const authed = requireAuth(auth, config);

  const routes = new Hono<AppEnv>();

  routes.post("/register", async (c) => {
    const ip = clientIp(c, config.trustProxy);
    const retryAfter = registerByIp.retryAfterSeconds(ip);
    if (retryAfter) throw tooManyAttempts(retryAfter);
    registerByIp.hit(ip);

    const input = await parseJson(c, registerInputSchema);
    const session = await auth.register(input, { userAgent: c.req.header("user-agent") });
    setSessionCookie(c, config, session.token, session.expiresAt);
    return c.json<AuthResponse>({ user: session.user }, 201);
  });

  routes.post("/login", async (c) => {
    const input = await parseJson(c, loginInputSchema);
    const ipKey = clientIp(c, config.trustProxy);
    const retryAfter = Math.max(
      loginByIdentifier.retryAfterSeconds(input.identifier),
      loginByIp.retryAfterSeconds(ipKey),
    );
    if (retryAfter) throw tooManyAttempts(retryAfter);

    try {
      const session = await auth.login(input, { userAgent: c.req.header("user-agent") });
      loginByIdentifier.reset(input.identifier);
      setSessionCookie(c, config, session.token, session.expiresAt);
      return c.json<AuthResponse>({ user: session.user });
    } catch (error) {
      if (error instanceof AppError && error.code === "invalid_credentials") {
        loginByIdentifier.hit(input.identifier);
        loginByIp.hit(ipKey);
      }
      throw error;
    }
  });

  routes.post("/logout", async (c) => {
    const token = getSessionToken(c);
    if (token) await auth.logout(token);
    clearSessionCookie(c);
    return c.body(null, 204);
  });

  routes.get("/me", authed, (c) => c.json<AuthResponse>({ user: c.var.user }));

  routes.post("/password", authed, async (c) => {
    const userId = c.var.user.id;
    const retryAfter = passwordByUser.retryAfterSeconds(userId);
    if (retryAfter) throw tooManyAttempts(retryAfter);

    const input = await parseJson(c, changePasswordSchema);
    try {
      await auth.changePassword(userId, c.var.sessionId, input);
      passwordByUser.reset(userId);
      return c.body(null, 204);
    } catch (error) {
      // A wrong current password is a guess at it, signed in or not.
      if (error instanceof AppError && error.fields?.currentPassword) passwordByUser.hit(userId);
      throw error;
    }
  });

  routes.get("/sessions", authed, async (c) =>
    c.json<SessionListResponse>({ sessions: await auth.listSessions(c.var.user.id, c.var.sessionId) }),
  );

  routes.post("/sessions/revoke-others", authed, async (c) => {
    await auth.revokeOtherSessions(c.var.user.id, c.var.sessionId);
    return c.body(null, 204);
  });

  routes.delete("/sessions/:id", authed, async (c) => {
    const id = c.req.param("id");
    await auth.revokeSession(c.var.user.id, id);
    if (id === c.var.sessionId) clearSessionCookie(c);
    return c.body(null, 204);
  });

  return routes;
}
