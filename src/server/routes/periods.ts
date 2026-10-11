import { Hono, type MiddlewareHandler } from "hono";
import { type LocateResponse, locateSchema, type PeriodView } from "../../shared/budget.ts";
import { type AppEnv, parseJson } from "../http.ts";
import type { PeriodService } from "../services/periods.ts";

export function periodRoutes(deps: { periods: PeriodService; authed: MiddlewareHandler<AppEnv> }) {
  const { periods } = deps;
  const routes = new Hono<AppEnv>();
  routes.use(deps.authed);

  routes.get("/current", async (c) => c.json<PeriodView>(await periods.getCurrent(c.var.user.id)));

  routes.post("/locate", async (c) => {
    const { date } = await parseJson(c, locateSchema);
    return c.json<LocateResponse>({ periodId: await periods.locate(c.var.user.id, date) });
  });

  routes.get("/:id", async (c) => c.json<PeriodView>(await periods.getView(c.var.user.id, c.req.param("id"))));

  return routes;
}
