import { Hono, type MiddlewareHandler } from "hono";
import { type BudgetResponse, settingsPatchSchema } from "../../shared/budget.ts";
import { type AppEnv, parseJson } from "../http.ts";
import type { PeriodService } from "../services/periods.ts";

export function settingsRoutes(deps: { periods: PeriodService; authed: MiddlewareHandler<AppEnv> }) {
  const { periods } = deps;
  const routes = new Hono<AppEnv>();
  routes.use(deps.authed);

  routes.patch("/", async (c) => {
    const { timezone } = await parseJson(c, settingsPatchSchema);
    return c.json<BudgetResponse>({ budget: await periods.setTimezone(c.var.user.id, timezone) });
  });

  return routes;
}
