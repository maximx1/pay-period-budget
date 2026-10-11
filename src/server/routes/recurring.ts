import { Hono, type MiddlewareHandler } from "hono";
import {
  endRecurringSchema,
  type RecurringListResponse,
  type RecurringPreview,
  type RecurringResponse,
  recurringInputSchema,
  recurringPatchSchema,
} from "../../shared/recurring.ts";
import { type AppEnv, parseJson } from "../http.ts";
import type { RecurringService } from "../services/recurring.ts";

export function recurringRoutes(deps: { recurring: RecurringService; authed: MiddlewareHandler<AppEnv> }) {
  const { recurring } = deps;
  const routes = new Hono<AppEnv>();
  routes.use(deps.authed);

  routes.get("/", async (c) => c.json<RecurringListResponse>({ items: await recurring.list(c.var.user.id) }));

  routes.post("/", async (c) => {
    const input = await parseJson(c, recurringInputSchema);
    return c.json<RecurringResponse>({ item: await recurring.create(c.var.user.id, input) }, 201);
  });

  routes.post("/preview", async (c) => {
    const input = await parseJson(c, recurringInputSchema);
    return c.json<RecurringPreview>(await recurring.preview(c.var.user.id, input));
  });

  routes.patch("/:id", async (c) => {
    const patch = await parseJson(c, recurringPatchSchema);
    return c.json<RecurringResponse>({ item: await recurring.update(c.var.user.id, c.req.param("id"), patch) });
  });

  routes.delete("/:id", async (c) => {
    await recurring.remove(c.var.user.id, c.req.param("id"));
    return c.body(null, 204);
  });

  routes.post("/:id/end", async (c) => {
    const options = await parseJson(c, endRecurringSchema);
    return c.json<RecurringResponse>({ item: await recurring.end(c.var.user.id, c.req.param("id"), options) });
  });

  return routes;
}
