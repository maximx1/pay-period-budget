import { Hono, type MiddlewareHandler } from "hono";
import {
  type CategoryListResponse,
  type CategoryResponse,
  categoryInputSchema,
  categoryPatchSchema,
} from "../../shared/categories.ts";
import { type AppEnv, parseJson } from "../http.ts";
import type { CategoryService } from "../services/categories.ts";

export function categoryRoutes(deps: { categories: CategoryService; authed: MiddlewareHandler<AppEnv> }) {
  const { categories } = deps;
  const routes = new Hono<AppEnv>();
  routes.use(deps.authed);

  routes.get("/", async (c) => c.json<CategoryListResponse>({ categories: await categories.list(c.var.user.id) }));

  routes.post("/", async (c) => {
    const input = await parseJson(c, categoryInputSchema);
    return c.json<CategoryResponse>({ category: await categories.create(c.var.user.id, input) }, 201);
  });

  routes.patch("/:id", async (c) => {
    const patch = await parseJson(c, categoryPatchSchema);
    return c.json<CategoryResponse>({ category: await categories.update(c.var.user.id, c.req.param("id"), patch) });
  });

  routes.delete("/:id", async (c) => {
    await categories.remove(c.var.user.id, c.req.param("id"));
    return c.body(null, 204);
  });

  return routes;
}
