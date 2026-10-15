import { Hono, type MiddlewareHandler } from "hono";
import {
  transactionImportSchema,
  type TransactionImportResponse,
  transactionInputSchema,
  type TransactionListResponse,
  transactionOrderSchema,
  transactionPatchSchema,
  transactionRangeSchema,
  type TransactionResponse,
  type TransactionSearchResponse,
  transactionSearchSchema,
} from "../../shared/transactions.ts";
import { MAX_SCAN_BYTES, type ScanResponse } from "../../shared/scan.ts";
import { type AppEnv, parseJson, parseQuery } from "../http.ts";
import { AppError } from "../lib/errors.ts";
import type { ImportService } from "../services/import.ts";
import type { ScanService } from "../services/scan.ts";
import type { TransactionService } from "../services/transactions.ts";

/** Where many transactions arrive in one request; app.ts allows this path a larger body. */
export const IMPORT_PATH = "/api/transactions/import";
/** Where a screenshot is sent to be read; app.ts allows it a body the size of a picture. */
export const SCAN_PATH = "/api/transactions/scan";

export function transactionRoutes(deps: {
  transactions: TransactionService;
  imports: ImportService;
  scans: ScanService;
  authed: MiddlewareHandler<AppEnv>;
}) {
  const { transactions, imports, scans } = deps;
  const routes = new Hono<AppEnv>();
  routes.use(deps.authed);

  routes.get("/", async (c) => {
    const range = parseQuery(c, transactionRangeSchema);
    return c.json<TransactionListResponse>({ transactions: await transactions.list(c.var.user.id, range) });
  });

  routes.get("/search", async (c) => {
    const query = parseQuery(c, transactionSearchSchema);
    return c.json<TransactionSearchResponse>(await transactions.search(c.var.user.id, query));
  });

  routes.post("/", async (c) => {
    const input = await parseJson(c, transactionInputSchema);
    return c.json<TransactionResponse>(await transactions.create(c.var.user.id, input), 201);
  });

  // A screenshot of a bank's list, as multipart form data with the picture under "image".
  // Reads it and reports the transactions it holds; saves nothing.
  routes.post("/scan", async (c) => {
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const image = body.image;
    if (!(image instanceof File) || image.size === 0) {
      throw new AppError(400, "validation", "Choose a screenshot", { image: "Choose a screenshot" });
    }
    if (image.size > MAX_SCAN_BYTES) throw new AppError(413, "validation", "That picture is too large. Keep it under 10 MB.");
    return c.json<ScanResponse>(await scans.scan(c.var.user.id, new Uint8Array(await image.arrayBuffer())));
  });

  routes.post("/import", async (c) => {
    const input = await parseJson(c, transactionImportSchema);
    return c.json<TransactionImportResponse>(await imports.importTransactions(c.var.user.id, input));
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
