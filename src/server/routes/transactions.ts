import { Hono, type MiddlewareHandler } from "hono";
import {
  transactionInputSchema,
  type TransactionListResponse,
  transactionOrderSchema,
  transactionPatchSchema,
  transactionRangeSchema,
  type TransactionResponse,
} from "../../shared/transactions.ts";
import { type AppEnv, parseJson, parseQuery } from "../http.ts";
import type { TransactionService } from "../services/transactions.ts";

export function transactionRoutes(deps: { transactions: TransactionService; authed: MiddlewareHandler<AppEnv> }) {
  const { transactions } = deps;
  const routes = new Hono<AppEnv>();
  routes.use(deps.authed);

  routes.get("/", async (c) => {
    const range = parseQuery(c, transactionRangeSchema);
    return c.json<TransactionListResponse>({ transactions: await transactions.list(c.var.user.id, range) });
  });

  routes.post("/", async (c) => {
    const input = await parseJson(c, transactionInputSchema);
    return c.json<TransactionResponse>(await transactions.create(c.var.user.id, input), 201);
  });

  // Registered before "/:id" routes so "order" is never taken for an id.
  routes.put("/order", async (c) => {
    const { ids } = await parseJson(c, transactionOrderSchema);
    await transactions.reorder(c.var.user.id, ids);
    return c.body(null, 204);
  });

  routes.patch("/:id", async (c) => {
    const patch = await parseJson(c, transactionPatchSchema);
    return c.json<TransactionResponse>(await transactions.update(c.var.user.id, c.req.param("id"), patch));
  });

  routes.delete("/:id", async (c) => {
    await transactions.remove(c.var.user.id, c.req.param("id"));
    return c.body(null, 204);
  });

  return routes;
}
