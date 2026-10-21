import { Hono, type MiddlewareHandler } from "hono";
import { categoryLimitSchema } from "../../shared/categories.ts";
import {
  type LocateResponse,
  locateSchema,
  type PeriodDatesResponse,
  type PeriodListResponse,
  type PeriodView,
  periodDatesSchema,
  startingAmountSchema,
} from "../../shared/budget.ts";
import type { BalanceOutlook } from "../../shared/outlook.ts";
import { type AppEnv, parseJson } from "../http.ts";
import type { OutlookService } from "../services/outlook.ts";
import type { PeriodService } from "../services/periods.ts";

export function periodRoutes(deps: { periods: PeriodService; outlook: OutlookService; authed: MiddlewareHandler<AppEnv> }) {
  const { periods, outlook } = deps;
  const routes = new Hono<AppEnv>();
  routes.use(deps.authed);

  routes.get("/", async (c) => c.json<PeriodListResponse>({ periods: await periods.list(c.var.user.id) }));

  routes.get("/current", async (c) => c.json<PeriodView>(await periods.getCurrent(c.var.user.id)));

  // Before "/:id", which would otherwise take "outlook" for a period id.
  routes.get("/outlook", async (c) => c.json<BalanceOutlook>(await outlook.get(c.var.user.id)));

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

  routes.put("/:id/limits/:categoryId", async (c) => {
    const { limitCents } = await parseJson(c, categoryLimitSchema);
    const { id, categoryId } = c.req.param();
    return c.json<PeriodView>(await periods.setLimit(c.var.user.id, id, categoryId, limitCents));
  });

  routes.delete("/:id/limits/:categoryId", async (c) => {
    const { id, categoryId } = c.req.param();
    return c.json<PeriodView>(await periods.removeLimit(c.var.user.id, id, categoryId));
  });

  return routes;
}
