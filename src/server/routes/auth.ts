import { Hono } from "hono";
import { type AuthResponse, loginInputSchema, registerInputSchema } from "../../shared/auth.ts";
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

  routes.get("/me", requireAuth(auth, config), (c) => c.json<AuthResponse>({ user: c.var.user }));

  return routes;
}
