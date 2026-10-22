import { z } from "zod";

// Docker Compose passes a setting left out of .env as an empty string.
const blankIsUnset = <T extends z.ZodType>(schema: T) => z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

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
  // An OpenAI-compatible model of the owner's own for reading screenshots (phase 21).
  SCAN_MODEL_URL: blankIsUnset(z.url()),
  SCAN_MODEL: blankIsUnset(z.string()),
  SCAN_MODEL_KEY: blankIsUnset(z.string()),
  SCAN_MODEL_ENABLED: z.enum(["true", "false"]).default("true"),
  SCAN_MODEL_IMAGES: z.enum(["true", "false"]).default("false"),
  SCAN_MODEL_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(600).default(90),
  // The Advice page (phase 22): off unless asked for. Each ADVICE_MODEL_* left out takes the
  // SCAN_MODEL_* one, so one model can serve both, and each can be switched off by itself.
  ADVICE_ENABLED: z.enum(["true", "false"]).default("false"),
  ADVICE_MODEL_URL: blankIsUnset(z.url()),
  ADVICE_MODEL: blankIsUnset(z.string()),
  ADVICE_MODEL_KEY: blankIsUnset(z.string()),
  ADVICE_MODEL_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(600).default(180),
  // "false" asks a model that thinks before answering (Qwen 3 and the like) not to. Only
  // servers that take chat_template_kwargs understand it (llama.cpp, vLLM, SGLang).
  ADVICE_MODEL_THINKING: z.enum(["true", "false"]).default("true"),
});

/** Where an OpenAI-compatible model is, and how long to wait for it. */
export type ModelConfig = {
  /** Base address of an OpenAI-compatible API, e.g. http://localhost:11434/v1. */
  url: string;
  model: string;
  apiKey: string | null;
  timeoutMs: number;
  /**
   * False asks the model to answer without thinking first, by sending
   * `chat_template_kwargs: { enable_thinking: false }`. Left out, nothing extra is sent: an
   * API that doesn't know the field, such as OpenAI's, refuses the request.
   */
  thinking?: false;
};

/** A model the server sends screenshots' text (or the screenshots) to, in place of the built-in reader. */
export type ScanModelConfig = ModelConfig & {
  /** Send the picture itself, for a model that can see; otherwise the text the built-in reader found. */
  images: boolean;
};

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
  /**
   * The owner's own model for reading screenshots, or null for the built-in reader alone.
   * Null unless SCAN_MODEL_URL and SCAN_MODEL are set, and while SCAN_MODEL_ENABLED=false,
   * which turns it off without losing the settings.
   */
  scanModel: ScanModelConfig | null;
  /**
   * The model the Advice page asks, or null when the page is off. Null unless
   * ADVICE_ENABLED=true and a model address and name are set, its own or the scan model's.
   */
  adviceModel: ModelConfig | null;
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
    scanModel:
      parsed.SCAN_MODEL_URL && parsed.SCAN_MODEL && parsed.SCAN_MODEL_ENABLED === "true"
        ? {
            url: parsed.SCAN_MODEL_URL.replace(/\/+$/, ""),
            model: parsed.SCAN_MODEL,
            apiKey: parsed.SCAN_MODEL_KEY ?? null,
            images: parsed.SCAN_MODEL_IMAGES === "true",
            timeoutMs: parsed.SCAN_MODEL_TIMEOUT_SECONDS * 1000,
          }
        : null,
    adviceModel: adviceModelOf(parsed),
  };
}

function adviceModelOf(parsed: z.output<typeof envSchema>): ModelConfig | null {
  if (parsed.ADVICE_ENABLED !== "true") return null;
  const url = parsed.ADVICE_MODEL_URL ?? parsed.SCAN_MODEL_URL;
  const model = parsed.ADVICE_MODEL ?? parsed.SCAN_MODEL;
  if (!url || !model) return null;
  return {
    url: url.replace(/\/+$/, ""),
    model,
    apiKey: parsed.ADVICE_MODEL_KEY ?? parsed.SCAN_MODEL_KEY ?? null,
    timeoutMs: parsed.ADVICE_MODEL_TIMEOUT_SECONDS * 1000,
    ...(parsed.ADVICE_MODEL_THINKING === "false" && { thinking: false as const }),
  };
}
