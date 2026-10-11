import { Hono, type MiddlewareHandler } from "hono";
import { type BudgetResponse, budgetSetupSchema } from "../../shared/budget.ts";
import { type AppEnv, parseJson } from "../http.ts";
import type { PeriodService } from "../services/periods.ts";

export function budgetRoutes(deps: { periods: PeriodService; authed: MiddlewareHandler<AppEnv> }) {
  const { periods } = deps;
  const routes = new Hono<AppEnv>();
  routes.use(deps.authed);

  routes.get("/", async (c) => c.json<BudgetResponse>({ budget: await periods.getBudget(c.var.user.id) }));

  routes.post("/", async (c) => {
    const input = await parseJson(c, budgetSetupSchema);
    return c.json<BudgetResponse>({ budget: await periods.setup(c.var.user.id, input) }, 201);
  });

  return routes;
}
