import { Hono, type MiddlewareHandler } from "hono";
import {
  type LocateResponse,
  locateSchema,
  type PeriodDatesResponse,
  type PeriodListResponse,
  type PeriodView,
  periodDatesSchema,
  startingAmountSchema,
} from "../../shared/budget.ts";
import { type AppEnv, parseJson } from "../http.ts";
import type { PeriodService } from "../services/periods.ts";

export function periodRoutes(deps: { periods: PeriodService; authed: MiddlewareHandler<AppEnv> }) {
  const { periods } = deps;
  const routes = new Hono<AppEnv>();
  routes.use(deps.authed);

  routes.get("/", async (c) => c.json<PeriodListResponse>({ periods: await periods.list(c.var.user.id) }));

  routes.get("/current", async (c) => c.json<PeriodView>(await periods.getCurrent(c.var.user.id)));

  routes.post("/locate", async (c) => {
    const { date } = await parseJson(c, locateSchema);
    return c.json<LocateResponse>({ periodId: await periods.locate(c.var.user.id, date) });
  });

  routes.post("/earlier", async (c) => c.json<LocateResponse>({ periodId: await periods.addEarlier(c.var.user.id) }));

  routes.get("/:id", async (c) => c.json<PeriodView>(await periods.getView(c.var.user.id, c.req.param("id"))));

  routes.patch("/:id/starting", async (c) => {
    const input = await parseJson(c, startingAmountSchema);
    return c.json<PeriodView>(await periods.setStarting(c.var.user.id, c.req.param("id"), input));
  });

  routes.post("/:id/starting/revert", async (c) =>
    c.json<PeriodView>(await periods.revertStarting(c.var.user.id, c.req.param("id"))),
  );

  routes.post("/:id/recalculate", async (c) =>
    c.json<PeriodView>(await periods.recalculate(c.var.user.id, c.req.param("id"))),
  );

  routes.patch("/:id/dates", async (c) => {
    const input = await parseJson(c, periodDatesSchema);
    return c.json<PeriodDatesResponse>(await periods.changeDates(c.var.user.id, c.req.param("id"), input));
  });

  routes.post("/:id/dates/revert", async (c) =>
    c.json<PeriodDatesResponse>(await periods.revertDates(c.var.user.id, c.req.param("id"))),
  );

  return routes;
}
