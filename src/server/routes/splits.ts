import { Hono, type MiddlewareHandler } from "hono";
import type { AddWaitingResponse, WaitingSplitsResponse } from "../../shared/split.ts";
import type { AppEnv } from "../http.ts";
import type { SplitService } from "../services/split.ts";

/** What splits left waiting for pay periods too far ahead to exist yet. Splitting itself is POST /api/transactions/split. */
export function splitRoutes(deps: { splits: SplitService; authed: MiddlewareHandler<AppEnv> }) {
  const { splits } = deps;
  const routes = new Hono<AppEnv>();
  routes.use(deps.authed);

  routes.get("/", async (c) => c.json<WaitingSplitsResponse>(await splits.waiting(c.var.user.id)));

  routes.post("/:id/add", async (c) => c.json<AddWaitingResponse>(await splits.addWaiting(c.var.user.id, c.req.param("id"))));

  routes.delete("/:id", async (c) => {
    await splits.cancelWaiting(c.var.user.id, c.req.param("id"));
    return c.body(null, 204);
  });

  return routes;
}
