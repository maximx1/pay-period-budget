import { Hono, type MiddlewareHandler } from "hono";
import {
  endBillOrIncomeSchema,
  type BillsIncomeListResponse,
  type BillOrIncomePreview,
  type BillOrIncomeResponse,
  type BillOrIncomeTransactionsResponse,
  billOrIncomeInputSchema,
  billOrIncomePatchSchema,
  billOrIncomeTransactionsQuerySchema,
} from "../../shared/billsIncome.ts";
import { type AppEnv, parseJson, parseQuery } from "../http.ts";
import type { BillsIncomeService } from "../services/billsIncome.ts";

export function billsIncomeRoutes(deps: { billsIncome: BillsIncomeService; authed: MiddlewareHandler<AppEnv> }) {
  const { billsIncome } = deps;
  const routes = new Hono<AppEnv>();
  routes.use(deps.authed);

  routes.get("/", async (c) => c.json<BillsIncomeListResponse>({ items: await billsIncome.list(c.var.user.id) }));

  routes.post("/", async (c) => {
    const input = await parseJson(c, billOrIncomeInputSchema);
    return c.json<BillOrIncomeResponse>({ item: await billsIncome.create(c.var.user.id, input) }, 201);
  });

  routes.post("/preview", async (c) => {
    const input = await parseJson(c, billOrIncomeInputSchema);
    return c.json<BillOrIncomePreview>(await billsIncome.preview(c.var.user.id, input));
  });

  routes.get("/:id/transactions", async (c) => {
    const query = parseQuery(c, billOrIncomeTransactionsQuerySchema);
    return c.json<BillOrIncomeTransactionsResponse>(
      await billsIncome.transactions(c.var.user.id, c.req.param("id"), query),
    );
  });

  routes.patch("/:id", async (c) => {
    const patch = await parseJson(c, billOrIncomePatchSchema);
    return c.json<BillOrIncomeResponse>({ item: await billsIncome.update(c.var.user.id, c.req.param("id"), patch) });
  });

  routes.delete("/:id", async (c) => {
    await billsIncome.remove(c.var.user.id, c.req.param("id"));
    return c.body(null, 204);
  });

  routes.post("/:id/end", async (c) => {
    const options = await parseJson(c, endBillOrIncomeSchema);
    return c.json<BillOrIncomeResponse>({ item: await billsIncome.end(c.var.user.id, c.req.param("id"), options) });
  });

  return routes;
}
