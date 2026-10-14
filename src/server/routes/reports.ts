import { Hono, type MiddlewareHandler } from "hono";
import { type Report, reportQuerySchema } from "../../shared/reports.ts";
import { type AppEnv, parseQuery } from "../http.ts";
import type { ReportService } from "../services/reports.ts";

export function reportRoutes(deps: { reports: ReportService; authed: MiddlewareHandler<AppEnv> }) {
  const { reports } = deps;
  const routes = new Hono<AppEnv>();
  routes.use(deps.authed);

  routes.get("/", async (c) => c.json<Report>(await reports.build(c.var.user.id, parseQuery(c, reportQuerySchema))));

  return routes;
}
