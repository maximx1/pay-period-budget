import { Hono, type MiddlewareHandler } from "hono";
import {
  type AddWaitingResponse,
  splitAddSchema,
  type SplitChangeResponse,
  splitSkipSchema,
  type WaitingSplitsResponse,
} from "../../shared/split.ts";
import { type AppEnv, parseJson } from "../http.ts";
import type { SplitService } from "../services/split.ts";

/**
 * Splits with something still to pay: adding to one, skipping a payment, and what waits for
 * pay periods too far ahead to exist yet. Splitting itself is POST /api/transactions/split.
 */
export function splitRoutes(deps: { splits: SplitService; authed: MiddlewareHandler<AppEnv> }) {
  const { splits } = deps;
  const routes = new Hono<AppEnv>();
  routes.use(deps.authed);

  routes.get("/", async (c) => c.json<WaitingSplitsResponse>(await splits.waiting(c.var.user.id)));

  // More items, spread from the pay period of `occursAt`; the unpaid payments from there are worked out again.
  routes.post("/:id/items", async (c) => {
    const input = await parseJson(c, splitAddSchema);
    return c.json<SplitChangeResponse>(await splits.add(c.var.user.id, c.req.param("id"), input));
  });

  // One unpaid payment left out, and what it held spread over the payments after it.
  routes.post("/:id/skip", async (c) => {
    const input = await parseJson(c, splitSkipSchema);
    return c.json<SplitChangeResponse>(await splits.skip(c.var.user.id, c.req.param("id"), input));
  });

  routes.post("/:id/add", async (c) => c.json<AddWaitingResponse>(await splits.addWaiting(c.var.user.id, c.req.param("id"))));

  routes.delete("/:id", async (c) => {
    await splits.cancelWaiting(c.var.user.id, c.req.param("id"));
    return c.body(null, 204);
  });

  return routes;
}
