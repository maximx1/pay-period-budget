import { Hono, type MiddlewareHandler } from "hono";
import { type BudgetResponse, settingsPatchSchema } from "../../shared/budget.ts";
import { lowBalanceSettingsSchema, type LowBalanceSettingsResponse } from "../../shared/outlook.ts";
import { type AppEnv, parseJson } from "../http.ts";
import type { OutlookService } from "../services/outlook.ts";
import type { PeriodService } from "../services/periods.ts";

export function settingsRoutes(deps: { periods: PeriodService; outlook: OutlookService; authed: MiddlewareHandler<AppEnv> }) {
  const { periods, outlook } = deps;
  const routes = new Hono<AppEnv>();
  routes.use(deps.authed);

  routes.patch("/", async (c) => {
    const { timezone } = await parseJson(c, settingsPatchSchema);
    return c.json<BudgetResponse>({ budget: await periods.setTimezone(c.var.user.id, timezone) });
  });

  // Read back through GET /api/periods/outlook, which reports the settings it used.
  routes.put("/low-balance", async (c) => {
    const settings = await parseJson(c, lowBalanceSettingsSchema);
    return c.json<LowBalanceSettingsResponse>({ settings: await outlook.setSettings(c.var.user.id, settings) });
  });

  return routes;
}
