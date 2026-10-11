import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import type { AppConfig } from "./env.ts";
import { type AppEnv, originGuard } from "./http.ts";
import { AppError } from "./lib/errors.ts";
import type { DataStore } from "./repos/types.ts";
import { requireAuth } from "./middleware/session.ts";
import { authRoutes } from "./routes/auth.ts";
import { budgetRoutes } from "./routes/budget.ts";
import { periodRoutes } from "./routes/periods.ts";
import { recurringRoutes } from "./routes/recurring.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { transactionRoutes } from "./routes/transactions.ts";
import { createAuthService } from "./services/auth.ts";
import { materializeAllInPeriod } from "./services/materialize.ts";
import { createPeriodService } from "./services/periods.ts";
import { createRecurringService } from "./services/recurring.ts";
import { createTransactionService } from "./services/transactions.ts";

export type AppDeps = {
  store: DataStore;
  config: AppConfig;
  now?: () => Date;
  /** Directory holding the built client. When set, the API also serves the SPA. */
  staticDir?: string;
};

export function createApp({ store, config, now, staticDir }: AppDeps) {
  const auth = createAuthService({ store, sessionTtlMs: config.sessionTtlMs, now });
  const clock = now ?? (() => new Date());
  const periods = createPeriodService({
    store,
    now,
    // Each new period gets its recurring bills and income before the next is derived from it.
    onPeriodCreated: (repos, period) => materializeAllInPeriod(repos, period, clock()),
  });
  const transactions = createTransactionService({ store, periods, now });
  const recurring = createRecurringService({ store, periods, now });
  const authed = requireAuth(auth, config);

  const api = new Hono<AppEnv>();
  api.use(originGuard(config.appOrigins));
  api.use(bodyLimit({ maxSize: 100 * 1024 }));
  api.get("/health", (c) => c.json({ ok: true }));
  api.route("/auth", authRoutes({ auth, config, now }));
  // New feature routers mount here. Each one takes `authed` and applies it to all its routes.
  api.route("/budget", budgetRoutes({ periods, authed }));
  api.route("/periods", periodRoutes({ periods, authed }));
  api.route("/transactions", transactionRoutes({ transactions, authed }));
  api.route("/recurring", recurringRoutes({ recurring, authed }));
  api.route("/settings", settingsRoutes({ periods, authed }));
  api.all("*", () => {
    throw new AppError(404, "not_found", "No such endpoint");
  });

  const app = new Hono<AppEnv>();
  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        frameAncestors: ["'none'"],
      },
    }),
  );
  app.route("/api", api);

  if (staticDir) {
    app.use("/assets/*", async (c, next) => {
      await next();
      if (c.res.ok) c.header("Cache-Control", "public, max-age=31536000, immutable");
    });
    // The HTML names the current hashed assets, so it must be revalidated on every visit.
    app.use(async (c, next) => {
      await next();
      if (c.res.headers.get("content-type")?.startsWith("text/html")) c.header("Cache-Control", "no-cache");
    });
    app.use(serveStatic({ root: staticDir }));
    // Client-side routes all resolve to the SPA shell.
    app.get("*", serveStatic({ root: staticDir, path: "index.html" }));
  }

  app.onError((error, c) => {
    if (error instanceof AppError) {
      for (const [name, value] of Object.entries(error.headers ?? {})) c.header(name, value);
      return c.json(error.toBody(), error.status);
    }
    console.error(error);
    return c.json(new AppError(500, "internal", "Something went wrong").toBody(), 500);
  });

  return { app, auth };
}
