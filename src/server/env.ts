import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // API_PORT wins. PORT is honoured only in production, where the API is the one server;
  // in development PORT tends to be set by tooling and means the web dev server.
  API_PORT: z.coerce.number().int().positive().optional(),
  PORT: z.coerce.number().int().positive().optional(),
  DATABASE_URL: z.string().min(1).default("file:./data/app.db"),
  APP_ORIGINS: z.string().default("http://localhost:5173"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  IDLE_TIMEOUT_MINUTES: z.coerce.number().int().min(0).max(24 * 60).default(10),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  ALLOW_REGISTRATION: z.enum(["true", "false"]).default("true"),
  ALLOW_API_TOKENS: z.enum(["true", "false"]).default("true"),
});

export type AppConfig = {
  isProduction: boolean;
  port: number;
  databaseUrl: string;
  /** Browser origins allowed to make state-changing requests. */
  appOrigins: string[];
  sessionTtlMs: number;
  /**
   * How long the web app may go unused before it signs out, and the Android app before it
   * locks. 0 turns both off.
   */
  idleTimeoutMs: number;
  trustProxy: boolean;
  /** Whether the session cookie is HTTPS-only. Defaults to on in production. */
  cookieSecure: boolean;
  /** Whether new accounts can be created. Turn off once yours exists on a server others can reach. */
  allowRegistration: boolean;
  /**
   * Whether API tokens work at all. They are the only way in for an assistant (the MCP
   * server), so off means no assistant can reach the budget. Tokens are kept while it is off.
   */
  allowApiTokens: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  return {
    isProduction: parsed.NODE_ENV === "production",
    port: parsed.API_PORT ?? (parsed.NODE_ENV === "production" ? parsed.PORT : undefined) ?? 8787,
    databaseUrl: parsed.DATABASE_URL,
    appOrigins: parsed.APP_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    sessionTtlMs: parsed.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    idleTimeoutMs: parsed.IDLE_TIMEOUT_MINUTES * 60 * 1000,
    trustProxy: parsed.TRUST_PROXY === "true",
    cookieSecure: parsed.COOKIE_SECURE ? parsed.COOKIE_SECURE === "true" : parsed.NODE_ENV === "production",
    allowRegistration: parsed.ALLOW_REGISTRATION === "true",
    allowApiTokens: parsed.ALLOW_API_TOKENS === "true",
  };
}
