import { Hono } from "hono";
import type { Context } from "hono";
import {
  type ApiTokenCreatedResponse,
  apiTokenInputSchema,
  type ApiTokenListResponse,
  type AuthConfigResponse,
  type AuthResponse,
  changePasswordSchema,
  loginRequestSchema,
  registerRequestSchema,
  type SessionListResponse,
  type SessionTransport,
  type TokenAuthResponse,
} from "../../shared/auth.ts";
import type { AppConfig } from "../env.ts";
import { type AppEnv, clientIp, parseJson } from "../http.ts";
import { AppError } from "../lib/errors.ts";
import { RateLimiter } from "../lib/rateLimit.ts";
import {
  clearSessionCookie,
  readSessionToken,
  requireAuth,
  requireSession,
  setSessionCookie,
} from "../middleware/session.ts";
import type { AuthService, IssuedSession } from "../services/auth.ts";

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
  // Everything that manages the account itself: an API token is refused.
  const signedIn = requireSession(auth, config);

  /** Hands a new session to the client the way it asked for it. */
  function deliver(c: Context, session: IssuedSession, transport: SessionTransport): AuthResponse | TokenAuthResponse {
    if (transport === "token") {
      return { user: session.user, token: session.token, expiresAt: session.expiresAt.toISOString() };
    }
    setSessionCookie(c, config, session.token, session.expiresAt);
    return { user: session.user };
  }

  const routes = new Hono<AppEnv>();

  routes.get("/config", (c) =>
    c.json<AuthConfigResponse>({
      registrationOpen: config.allowRegistration,
      idleTimeoutMinutes: config.idleTimeoutMs / MINUTE,
    }),
  );

  /** What is known about the request that is signing in. A browser's session ends when left idle. */
  const metaOf = (c: Context, transport: SessionTransport) => ({
    userAgent: c.req.header("user-agent"),
    endsWhenIdle: transport === "cookie",
  });

  routes.post("/register", async (c) => {
    if (!config.allowRegistration) {
      throw new AppError(403, "forbidden", "New accounts can't be created on this server");
    }
    const ip = clientIp(c, config.trustProxy);
    const retryAfter = registerByIp.retryAfterSeconds(ip);
    if (retryAfter) throw tooManyAttempts(retryAfter);
    registerByIp.hit(ip);

    const { transport, ...input } = await parseJson(c, registerRequestSchema);
    const session = await auth.register(input, metaOf(c, transport));
    return c.json(deliver(c, session, transport), 201);
  });

  routes.post("/login", async (c) => {
    const { transport, ...input } = await parseJson(c, loginRequestSchema);
    const ipKey = clientIp(c, config.trustProxy);
    const retryAfter = Math.max(
      loginByIdentifier.retryAfterSeconds(input.identifier),
      loginByIp.retryAfterSeconds(ipKey),
    );
    if (retryAfter) throw tooManyAttempts(retryAfter);

    try {
      const session = await auth.login(input, metaOf(c, transport));
      loginByIdentifier.reset(input.identifier);
      return c.json(deliver(c, session, transport));
    } catch (error) {
      if (error instanceof AppError && error.code === "invalid_credentials") {
        loginByIdentifier.hit(input.identifier);
        loginByIp.hit(ipKey);
      }
      throw error;
    }
  });

  routes.post("/logout", async (c) => {
    const carried = readSessionToken(c);
    if (carried) await auth.logout(carried.token);
    clearSessionCookie(c);
    return c.body(null, 204);
  });

  routes.get("/me", authed, (c) => c.json<AuthResponse>({ user: c.var.user }));

  routes.post("/password", signedIn, async (c) => {
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

  routes.get("/sessions", signedIn, async (c) =>
    c.json<SessionListResponse>({ sessions: await auth.listSessions(c.var.user.id, c.var.sessionId) }),
  );

  routes.post("/sessions/revoke-others", signedIn, async (c) => {
    await auth.revokeOtherSessions(c.var.user.id, c.var.sessionId);
    return c.body(null, 204);
  });

  routes.delete("/sessions/:id", signedIn, async (c) => {
    const id = c.req.param("id");
    await auth.revokeSession(c.var.user.id, id);
    if (id === c.var.sessionId) clearSessionCookie(c);
    return c.body(null, 204);
  });

  routes.get("/tokens", signedIn, async (c) =>
    c.json<ApiTokenListResponse>({ tokens: await auth.listApiTokens(c.var.user.id) }),
  );

  routes.post("/tokens", signedIn, async (c) => {
    const input = await parseJson(c, apiTokenInputSchema);
    return c.json<ApiTokenCreatedResponse>(await auth.createApiToken(c.var.user.id, input), 201);
  });

  routes.delete("/tokens/:id", signedIn, async (c) => {
    await auth.revokeApiToken(c.var.user.id, c.req.param("id"));
    return c.body(null, 204);
  });

  return routes;
}
