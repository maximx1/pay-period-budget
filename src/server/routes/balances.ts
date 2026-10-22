import { Hono, type MiddlewareHandler } from "hono";
import {
  balanceCheckInputSchema,
  balanceSettingsSchema,
  type BalanceHistoryResponse,
  type BalancesResponse,
  snoozeInputSchema,
  type TrackedBalanceResponse,
  trackBalanceInputSchema,
  trackedBalancePatchSchema,
} from "../../shared/balances.ts";
import { type AppEnv, parseJson } from "../http.ts";
import type { BalanceService } from "../services/balances.ts";

export function balanceRoutes(deps: { balances: BalanceService; authed: MiddlewareHandler<AppEnv> }) {
  const { balances } = deps;
  const routes = new Hono<AppEnv>();
  routes.use(deps.authed);

  routes.get("/", async (c) => c.json<BalancesResponse>(await balances.list(c.var.user.id)));

  routes.put("/settings", async (c) => {
    const settings = await parseJson(c, balanceSettingsSchema);
    return c.json({ settings: await balances.setSettings(c.var.user.id, settings) });
  });

  // Registered before "/:billIncomeId", which would otherwise take it.
  routes.post("/snooze-today", async (c) => {
    await balances.snoozeAsks(c.var.user.id);
    return c.body(null, 204);
  });

  routes.get("/:billIncomeId", async (c) =>
    c.json<BalanceHistoryResponse>(await balances.history(c.var.user.id, c.req.param("billIncomeId"))),
  );

  /** Starts tracking, with the first check. */
  routes.post("/:billIncomeId", async (c) => {
    const input = await parseJson(c, trackBalanceInputSchema);
    const balance = await balances.track(c.var.user.id, c.req.param("billIncomeId"), input);
    return c.json<TrackedBalanceResponse>({ balance }, 201);
  });

  routes.patch("/:billIncomeId", async (c) => {
    const patch = await parseJson(c, trackedBalancePatchSchema);
    return c.json<TrackedBalanceResponse>({ balance: await balances.update(c.var.user.id, c.req.param("billIncomeId"), patch) });
  });

  routes.delete("/:billIncomeId", async (c) => {
    await balances.untrack(c.var.user.id, c.req.param("billIncomeId"));
    return c.body(null, 204);
  });

  routes.post("/:billIncomeId/checks", async (c) => {
    const input = await parseJson(c, balanceCheckInputSchema);
    const balance = await balances.check(c.var.user.id, c.req.param("billIncomeId"), input);
    return c.json<TrackedBalanceResponse>({ balance }, 201);
  });

  routes.delete("/:billIncomeId/checks/:checkId", async (c) => {
    const balance = await balances.deleteCheck(c.var.user.id, c.req.param("billIncomeId"), c.req.param("checkId"));
    return c.json<TrackedBalanceResponse>({ balance });
  });

  routes.post("/:billIncomeId/looks-right", async (c) =>
    c.json<TrackedBalanceResponse>({ balance: await balances.looksRight(c.var.user.id, c.req.param("billIncomeId")) }, 201),
  );

  routes.post("/:billIncomeId/snooze", async (c) => {
    const { days } = await parseJson(c, snoozeInputSchema);
    return c.json<TrackedBalanceResponse>({ balance: await balances.snooze(c.var.user.id, c.req.param("billIncomeId"), days) });
  });

  return routes;
}
