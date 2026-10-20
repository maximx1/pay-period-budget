import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.ts";
import { createTestApp, type TestApp } from "../src/server/testing.ts";
import { MAX_IMPORT_ROWS } from "../src/shared/transactions.ts";
import { type Api, ApiRequestError, createApi } from "./api.ts";
import { ConfigError, readConfig } from "./config.ts";
import { buildMcpServer, failureText, whoAmI } from "./mcpServer.ts";
import { createTools, type Tool, ToolFailure } from "./tools.ts";

// The test clock starts at 2026-01-15T12:00Z; biweekly from 2025-12-16 gives
//   P0 2025-12-16..12-29   P1 2025-12-30..2026-01-12   P2 2026-01-13..01-26 (current)
const BASE = "https://budget.test";
const FILE = "/tmp/bank.json";

let t: TestApp;
let session: ReturnType<TestApp["client"]>;
let api: Api;
let tools: Tool[];
let files: Record<string, string>;
let requests: Array<{ method: string; path: string }>;
/** Set to make the next matching request fail the way a dropped connection does. */
let failWhen: ((request: { method: string; path: string; body: string }) => boolean) | null;

function connect(secret: string) {
  const send = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const request = { method: init?.method ?? "GET", path: url.pathname + url.search, body: String(init?.body ?? "") };
    requests.push(request);
    if (failWhen?.(request)) throw new TypeError("fetch failed", { cause: new Error("socket hang up") });
    return t.app.request(request.path, init);
  }) as typeof fetch;
  api = createApi({ baseUrl: `${BASE}/`, token: secret, fetch: send });
  tools = createTools({
    api,
    readFile: async (path) => {
      const text = files[path];
      if (text === undefined) throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      return text;
    },
    now: t.clock.now,
  });
}

async function newToken(scope: "read" | "write"): Promise<string> {
  const response = await session.post("/api/auth/tokens", { name: scope, scope });
  return (await response.json()).secret as string;
}

const call = (name: string, args: Record<string, unknown> = {}) => tools.find((tool) => tool.name === name)!.run(args);

const row = (date: string, overrides: Record<string, unknown> = {}) => ({
  name: "Groceries",
  amountCents: 2500,
  kind: "expense",
  occursAt: `${date}T00:00`,
  paid: true,
  ...overrides,
});
const writeFile = (rows: unknown, path = FILE) => {
  files[path] = JSON.stringify(rows);
};
const saved = async () =>
  (await (await session.get("/api/transactions?from=2025-06-01&to=2026-05-31")).json()).transactions as Array<{
    name: string;
    importKey: string | null;
  }>;

beforeEach(async () => {
  t = await createTestApp();
  files = {};
  requests = [];
  failWhen = null;
  session = t.client();
  await session.post("/api/auth/register", { username: "ann", email: "ann@example.com", password: "correct horse" });
  await session.post("/api/budget", { type: "biweekly", anchorDate: "2025-12-16", openingCents: 100_000, timezone: "UTC" });
  await session.get("/api/periods/current");
  connect(await newToken("write"));
});
afterEach(() => t.cleanup());

describe("reading the budget", () => {
  it("describes how the budget is set up, with today in its own time zone", async () => {
    expect(await call("get_budget")).toBe(
      [
        "Account: ann",
        "Pay schedule: biweekly, first pay period began 2025-12-16",
        "Opening balance on that day: $1,000.00 (100000 cents)",
        "Time zone: UTC",
        "Now in that zone: 2026-01-15 12:00",
      ].join("\n"),
    );
  });

  it("lists the periods and marks the current one", async () => {
    const text = await call("list_periods");
    expect(text.split("\n")).toEqual([
      "3 pay periods:",
      expect.stringMatching(/^- 2025-12-16 to 2025-12-29 \(id [\w-]+\)$/),
      expect.stringMatching(/^- 2025-12-30 to 2026-01-12 \(id [\w-]+\)$/),
      expect.stringMatching(/^- 2026-01-13 to 2026-01-26 \(id [\w-]+\) \(the current period\)$/),
    ]);
  });

  it("shows a period by default, by date and by id, with both leftover figures", async () => {
    await call("create_transaction", row("2026-01-20", { amountCents: 5412 }));
    await call("create_transaction", row("2026-01-21", { name: "Paycheck", amountCents: 200_000, kind: "income", paid: false }));

    const current = await call("get_period");
    expect(current).toContain("Period 2026-01-13 to 2026-01-26 (the current period) | id ");
    expect(current).toContain("Starting amount: $1,000.00 (100000 cents)");
    expect(current).toContain("Paid: -$54.12 (-5412 cents)");
    expect(current).toContain("Upcoming: $2,000.00 (200000 cents)");
    expect(current).toContain("Leftover so far (starting + paid): $945.88 (94588 cents)");
    expect(current).toContain("Projected leftover (starting + paid + upcoming): $2,945.88 (294588 cents)");
    expect(current).toContain("2 transactions:");
    expect(current).toMatch(/- 2026-01-20 00:00 \| -\$54\.12 \(-5412 cents\) \| paid \| Groceries \| id [\w-]+/);

    expect(await call("get_period", { date: "2026-01-26" })).toBe(current);
    const id = /\| id ([\w-]+)/.exec(current)![1]!;
    expect(await call("get_period", { id })).toBe(current);

    await expect(call("get_period", { date: "2026-06-01" })).rejects.toThrow(
      "No pay period covers 2026-06-01. Existing periods run from 2025-12-16 to 2026-01-26.",
    );
    await expect(call("get_period", { id, date: "2026-01-20" })).rejects.toThrow("not both");
    await expect(call("get_period", { id: "nope" })).rejects.toThrow("No such period");
  });

  it("lists transactions by date with their origin, and bills and income", async () => {
    const created = await session.post("/api/bills-income", {
      name: "Rent",
      kind: "expense",
      defaultAmountCents: 90_000,
      recurrenceUnit: "month",
      recurrenceInterval: 1,
      firstDueDate: "2026-01-25",
      description: "to the landlord",
    });
    expect(created.status).toBe(201);
    writeFile([row("2026-01-20", { importKey: "bank-1", note: "weekly shop" })]);
    await call("import_transactions", { file: FILE, dryRun: false });

    const text = await call("list_transactions", { from: "2026-01-01", to: "2026-01-31" });
    const lines = text.split("\n");
    expect(lines[0]).toBe("2 transactions from 2026-01-01 to 2026-01-31, net -$925.00 (-92500 cents):");
    expect(lines[1]).toMatch(
      /^- 2026-01-20 00:00 \| -\$25\.00 \(-2500 cents\) \| paid \| Groceries \| note: weekly shop \| imported as "bank-1" \| id [\w-]+$/,
    );
    expect(lines[2]).toMatch(
      /^- 2026-01-25 00:00 \| -\$900\.00 \(-90000 cents\) \| upcoming \| Rent \| generated from bill or income [\w-]+ \| id [\w-]+$/,
    );
    await expect(call("list_transactions", { from: "2026-01-01", to: "2028-01-01" })).rejects.toThrow(ApiRequestError);

    expect(await call("list_bills_income")).toMatch(
      /^1 bill or income:\n- Rent \| expense \| -\$900\.00 \(-90000 cents\) each time \| .+ \| first due 2026-01-25 \| next due 2026-01-25 \| description: to the landlord \| id [\w-]+$/,
    );
  });
});

describe("changing one transaction", () => {
  it("adds, changes and deletes", async () => {
    const added = await call("create_transaction", row("2026-01-20", { paid: false }));
    expect(added).toMatch(/^Added: 2026-01-20 00:00 \| -\$25\.00 \(-2500 cents\) \| upcoming \| Groceries \| id [\w-]+\nIn the period 2026-01-13 to 2026-01-26 \(id [\w-]+\)$/);
    const id = /\| id ([\w-]+)/.exec(added)![1]!;

    const changed = await call("update_transaction", { id, amountCents: 2610, occursAt: "2026-01-05T09:15", status: "paid" });
    expect(changed).toMatch(/^Changed: 2026-01-05 09:15 \| -\$26\.10 \(-2610 cents\) \| paid \| Groceries \| id [\w-]+\nIn the period 2025-12-30 to 2026-01-12/);

    await expect(call("update_transaction", { id })).rejects.toThrow("Give at least one field to change.");
    await expect(call("update_transaction", { id: "nope", name: "x" })).rejects.toThrow("No such transaction");

    expect(await call("delete_transaction", { id })).toBe(`Deleted transaction ${id}.`);
    expect(await saved()).toEqual([]);
  });

  it("checks arguments before sending anything", async () => {
    requests = [];
    await expect(call("create_transaction", row("2026-01-20", { amountCents: -5 }))).rejects.toThrow();
    await expect(call("create_transaction", row("2026-01-20", { occursAt: "20 Jan" }))).rejects.toThrow();
    expect(requests).toEqual([]);
  });

  it("passes on what the server says when it refuses", async () => {
    const error = await call("create_transaction", row("2024-01-20")).catch((caught: unknown) => caught);
    expect(failureText(error)).toBe("That's before your budget started\n- occursAt: That's before your budget started");
  });
});

describe("importing a file", () => {
  it("previews by default and saves nothing", async () => {
    await call("create_transaction", row("2026-01-20", { name: "typed in", paid: false }));
    writeFile([
      row("2026-01-05", { importKey: "bank-1", amountCents: 1000 }),
      row("2026-01-21", { importKey: "bank-2", name: "KROGER #512" }),
      row("2026-01-22", { amountCents: 300 }),
    ]);

    const text = await call("import_transactions", { file: FILE });
    expect(text.split("\n")).toEqual([
      "DRY RUN: nothing was saved. 3 transactions of the 3 in the file would be imported.",
      "1 row has no importKey: importing this file twice would add it twice.",
      "",
      "By pay period:",
      "- 2025-12-30 to 2026-01-12: 1 transaction, net -$10.00 (-1000 cents)",
      "- 2026-01-13 to 2026-01-26: 2 transactions, net -$28.00 (-2800 cents)",
      "",
      "Today's pay period:",
      "- Leftover so far: $1,000.00 (100000 cents) → $962.00 (96200 cents)",
      "- Projected leftover: $975.00 (97500 cents) → $937.00 (93700 cents)",
      "",
      expect.stringMatching(/^1 row may repeat a transaction the budget already holds \(same amount, within 3 days\)\. They would be imported anyway\./),
      expect.stringMatching(
        /^- row 1 2026-01-21 "KROGER #512" ↔ existing 2026-01-20 "typed in" -\$25\.00 \(-2500 cents\), upcoming, entered by hand, 1 day apart, id [\w-]+$/,
      ),
      "",
      "To import, call import_transactions again with dryRun: false.",
    ]);
    expect((await saved()).map((tx) => tx.name)).toEqual(["typed in"]);
  });

  it("saves when told to, and skips what it has already saved", async () => {
    writeFile({ transactions: [row("2026-01-05", { importKey: "bank-1" }), row("2026-01-21", { importKey: "bank-2" })] });

    const first = await call("import_transactions", { file: FILE, dryRun: false });
    expect(first.split("\n")[0]).toBe("Imported 2 transactions of the 2 in the file.");
    expect(first).not.toContain("To import, call");
    expect(first).toContain("- Leftover so far: $1,000.00 (100000 cents) → $950.00 (95000 cents)");

    writeFile([row("2026-01-05", { importKey: "bank-1" }), row("2026-01-22", { importKey: "bank-3" })]);
    const second = await call("import_transactions", { file: FILE, dryRun: false });
    expect(second.split("\n").slice(0, 2)).toEqual([
      "Imported 1 transaction of the 2 in the file.",
      "1 row was skipped because its import key is already in the budget.",
    ]);
    expect((await saved()).map((tx) => tx.importKey)).toEqual(["bank-1", "bank-2", "bank-3"]);
  });

  it("leaves out a row whose transaction was deleted, unless asked to bring it back", async () => {
    writeFile([row("2026-01-05", { importKey: "bank-1", name: "Unwanted" }), row("2026-01-21", { importKey: "bank-2" })]);
    await call("import_transactions", { file: FILE, dryRun: false });
    const line = (await call("list_transactions", { from: "2026-01-05", to: "2026-01-05" })).split("\n")[1]!;
    const deleted = await call("delete_transaction", { id: / id ([\w-]+)$/.exec(line)![1]! });
    expect(deleted).toMatch(/^Deleted transaction /);

    const again = await call("import_transactions", { file: FILE, dryRun: false });
    expect(again.split("\n").slice(0, 3)).toEqual([
      "Imported 0 transactions of the 2 in the file.",
      "1 row was skipped because its import key is already in the budget.",
      "1 row was skipped because the owner deleted that transaction from the budget. Run with restoreDeleted: true only if the owner wants them back.",
    ]);
    expect((await saved()).map((tx) => tx.name)).toEqual(["Groceries"]);

    const restored = await call("import_transactions", { file: FILE, dryRun: false, restoreDeleted: true });
    expect(restored.split("\n")[0]).toBe("Imported 1 transaction of the 2 in the file.");
    expect((await saved()).map((tx) => tx.name)).toEqual(["Unwanted", "Groceries"]);
  });

  it("reports every bad row by its place in the file and sends nothing", async () => {
    writeFile([
      row("2026-01-05", { importKey: "a" }),
      { ...row("2026-01-06"), amountCents: 25.5 },
      { name: "", kind: "spend", amountCents: 100, occursAt: "2026-01-07" },
      row("2026-01-08", { importKey: "a" }),
    ]);
    requests = [];

    const error = await call("import_transactions", { file: FILE, dryRun: false }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ToolFailure);
    expect((error as Error).message.split("\n")).toEqual([
      "5 problems in /tmp/bank.json (rows are counted from 0). Nothing was sent.",
      "- row 1: amountCents: Enter a whole number of cents",
      "- row 2: name: Enter a name",
      expect.stringMatching(/^- row 2: kind: /),
      "- row 2: occursAt: Enter a valid date and time",
      '- row 3: importKey: row 0 has the same key "a"',
    ]);
    expect(requests).toEqual([]);
  });

  it.each([
    ["a relative path", "bank.json", undefined, 'Give the file\'s absolute path. "bank.json" is relative.'],
    ["a missing file", "/tmp/missing.json", undefined, "Couldn't read /tmp/missing.json: ENOENT"],
    ["something that isn't JSON", FILE, "date,amount\n2026-01-05,12.00", "/tmp/bank.json is not valid JSON"],
    ["JSON that isn't a list", FILE, '{"rows": []}', "must hold a JSON array of rows"],
    ["an empty list", FILE, "[]", "The file has no rows."],
  ])("refuses %s", async (_label, path, content, message) => {
    if (content !== undefined) files[path] = content;
    requests = [];
    await expect(call("import_transactions", { file: path })).rejects.toThrow(message);
    expect(requests).toEqual([]);
  });

  it("explains rows the server would refuse, and how to allow earlier dates", async () => {
    writeFile([row("2026-01-05"), row("2025-12-10", { name: "Before the budget" })]);

    const error = await call("import_transactions", { file: FILE, dryRun: false }).catch((caught: unknown) => caught);
    expect((error as Error).message.split("\n")).toEqual([
      "The server would refuse 1 row of 2. Nothing was imported.",
      "- row 1 (2025-12-10 Before the budget): occursAt: That's before your budget started",
      "",
      "Rows dated before the earliest pay period need addEarlierPeriods: true, which adds the periods to hold them.",
    ]);
    expect(await saved()).toEqual([]);

    const allowed = await call("import_transactions", { file: FILE, dryRun: false, addEarlierPeriods: true });
    expect(allowed).toContain("Imported 2 transactions of the 2 in the file.");
    expect(allowed).toContain("Pay periods added: 1 before the earliest, 0 after the latest.");
    // History before the budget does not move today's figures; the row after it does.
    expect(allowed).toContain("- Leftover so far: $1,000.00 (100000 cents) → $975.00 (97500 cents)");
  });

  describe("a file larger than one request", () => {
    const COUNT = MAX_IMPORT_ROWS * 2 + 50;
    const manyRows = () =>
      Array.from({ length: COUNT }, (_, index) => {
        // Oldest first, a few before the budget, so each piece needs different periods.
        const day = new Date(Date.UTC(2025, 11, 10 + Math.floor(index / 40))).toISOString().slice(0, 10);
        return row(day, { amountCents: 100, importKey: `bank-${index}` });
      });
    const importRequests = () => requests.filter((request) => request.path === "/api/transactions/import").length;

    it("previews the whole file as one, then imports it to the same figures", async () => {
      writeFile(manyRows());
      requests = [];
      const preview = await call("import_transactions", { file: FILE, addEarlierPeriods: true });
      expect(importRequests()).toBe(3);
      expect(await saved()).toEqual([]);

      requests = [];
      const done = await call("import_transactions", { file: FILE, dryRun: false, addEarlierPeriods: true });
      // Checked in full as a dry run first, then saved.
      expect(importRequests()).toBe(6);
      expect(await saved()).toHaveLength(COUNT);

      const body = (text: string) => text.split("\n").slice(1).filter((line) => !line.startsWith("To import") && line !== "");
      expect(preview.split("\n")[0]).toBe(`DRY RUN: nothing was saved. ${COUNT} transactions of the ${COUNT} in the file would be imported.`);
      expect(done.split("\n")[0]).toBe(`Imported ${COUNT} transactions of the ${COUNT} in the file.`);
      expect(body(done)).toEqual(body(preview).map((line) => line.replace("that would be added", "added")));
      expect(preview).toContain("Pay periods that would be added: 1 before the earliest, 0 after the latest.");
      expect(preview).not.toContain("may repeat");

      // The per-period lines account for every row exactly once.
      const counted = [...done.matchAll(/: (\d+) transactions?, net/g)].reduce((sum, match) => sum + Number(match[1]), 0);
      expect(counted).toBe(COUNT);
    });

    it("refuses to save one whose rows could not be safely retried", async () => {
      const rows = manyRows();
      delete (rows[7] as Record<string, unknown>).importKey;
      writeFile(rows);
      requests = [];

      await expect(call("import_transactions", { file: FILE, dryRun: false, addEarlierPeriods: true })).rejects.toThrow(
        "1 row has no importKey. A file this size is sent in 3 requests",
      );
      expect(requests).toEqual([]);
      // A dry run of the same file is still allowed.
      await expect(call("import_transactions", { file: FILE, addEarlierPeriods: true })).resolves.toContain("DRY RUN");
    });

    it("says how far it got when the connection drops, and finishes on a second run", async () => {
      writeFile(manyRows());
      let realRequests = 0;
      failWhen = (request) => request.body.includes('"dryRun":false') && ++realRequests === 2;

      const error = await call("import_transactions", { file: FILE, dryRun: false, addEarlierPeriods: true }).catch(
        (caught: unknown) => caught,
      );
      expect((error as Error).message.split("\n")).toEqual([
        "The import stopped at rows 500 to 999: Couldn't reach the budget server at https://budget.test (socket hang up).",
        "Rows 0 to 499 are saved (500 transactions). Run the same file again to finish: rows already saved are skipped by their import keys.",
      ]);
      expect(await saved()).toHaveLength(MAX_IMPORT_ROWS);

      failWhen = null;
      const again = await call("import_transactions", { file: FILE, dryRun: false, addEarlierPeriods: true });
      expect(again.split("\n").slice(0, 2)).toEqual([
        `Imported ${COUNT - MAX_IMPORT_ROWS} transactions of the ${COUNT} in the file.`,
        "500 rows were skipped because their import key is already in the budget.",
      ]);
      expect(await saved()).toHaveLength(COUNT);
    });
  });
});

describe("bills and income", () => {
  const rent = { name: "Rent", kind: "expense", defaultAmountCents: 90_000, recurrenceUnit: "month", firstDueDate: "2026-01-25" };
  const idIn = (text: string) => /\| id ([\w-]+)/.exec(text)![1]!;
  const listedIds = async () =>
    ((await (await session.get("/api/bills-income")).json()).items as Array<{ id: string; name: string }>).map((item) => item.name);

  it("previews a new one by default, and says what saving it adds", async () => {
    const preview = await call("create_bill_or_income", rent);
    expect(preview.split("\n")).toEqual([
      "DRY RUN: nothing was saved. Would add 1 upcoming transaction to 1 existing pay period, the earliest on 2026-01-25.",
      "To add it, call create_bill_or_income again with dryRun: false.",
    ]);
    expect(await listedIds()).toEqual([]);
    expect(await saved()).toEqual([]);

    const added = await call("create_bill_or_income", { ...rent, dryRun: false });
    expect(added).toMatch(
      /^Added: Rent \| expense \| -\$900\.00 \(-90000 cents\) each time \| Every month on the 25th \| first due 2026-01-25 \| next due 2026-01-25 \| id [\w-]+\nAdded 1 upcoming transaction to 1 existing pay period, the earliest on 2026-01-25\.$/,
    );
    expect((await saved()).map((tx) => tx.name)).toEqual(["Rent"]);
  });

  it("warns when a first due date in the past would fill in periods that are over", async () => {
    expect(await call("create_bill_or_income", { ...rent, firstDueDate: "2025-12-20" })).toContain(
      "Would add 2 upcoming transactions to 2 existing pay periods, the earliest on 2025-12-20. " +
        "1 of those periods is already over: the entries arrive unpaid there, and the leftover carried through every later period changes.",
    );
  });

  it("adds one with no schedule, which brings nothing with it", async () => {
    const input = { name: "Side jobs", kind: "income", defaultAmountCents: 0, recurrenceUnit: "none" };
    expect(await call("create_bill_or_income", input)).toContain("Nothing would be added to the pay periods that exist.");

    const added = await call("create_bill_or_income", { ...input, dryRun: false });
    expect(added).toMatch(/^Added: Side jobs \| income \| no usual amount \| No schedule \| id [\w-]+\nNothing was added/);
    expect(await call("list_bills_income")).toMatch(/^1 bill or income:\n- Side jobs \| income \| no usual amount \| No schedule \| id /);
  });

  it("passes on what the server refuses", async () => {
    const error = await call("create_bill_or_income", { ...rent, defaultAmountCents: 0 }).catch((caught: unknown) => caught);
    expect(failureText(error)).toContain("- defaultAmountCents: Enter an amount greater than zero");
  });

  it("changes, ends and deletes one", async () => {
    const id = idIn(await call("create_bill_or_income", { ...rent, dryRun: false }));

    const changed = await call("update_bill_or_income", { id, defaultAmountCents: 95_000, name: "Rent (new lease)" });
    expect(changed).toMatch(/^Changed: Rent \(new lease\) \| expense \| -\$950\.00 \(-95000 cents\) each time \| .*\nTransactions that already exist are as they were\.$/);
    // The January entry it had already added keeps its old amount.
    expect(await call("list_transactions", { from: "2026-01-25", to: "2026-01-25" })).toContain("-$900.00 (-90000 cents) | upcoming | Rent |");
    await expect(call("update_bill_or_income", { id })).rejects.toThrow("Give at least one field to change.");

    const ended = await call("end_bill_or_income", { id, removeUpcoming: true });
    expect(ended).toMatch(/^Ended: Rent \(new lease\) \| .* \| ends 2026-01-15 \| /);
    expect(await saved()).toEqual([]);

    expect(await call("delete_bill_or_income", { id })).toBe(`Deleted bill or income ${id}. Its transactions remain, untied.`);
    expect(await listedIds()).toEqual([]);
    await expect(call("delete_bill_or_income", { id })).rejects.toThrow("No such bill or income");
  });

  it("ties a payment to an item, pays a bill in parts, and lists what an item has", async () => {
    const id = idIn(await call("create_bill_or_income", { ...rent, dryRun: false }));
    const due = idIn((await call("list_transactions", { from: "2026-01-25", to: "2026-01-25" })).split("\n")[1]!);

    const extra = await call("create_transaction", row("2026-01-18", { name: "Late fee", amountCents: 2500, billIncomeId: id }));
    expect(extra).toMatch(new RegExp(`\\| Late fee \\| tied to bill or income ${id} \\| id `));
    expect(extra).not.toContain("Counted toward");

    const part = await call("create_transaction", row("2026-01-20", { name: "Rent, part 1", amountCents: 30_000, countsToward: due }));
    expect(part.split("\n")[2]).toBe(
      "Counted toward Rent: -$900.00 (-90000 cents) was due; -$600.00 (-60000 cents) is still upcoming.",
    );
    const rest = await call("create_transaction", row("2026-01-24", { name: "Rent, part 2", amountCents: 60_000, countsToward: due }));
    expect(rest.split("\n")[2]).toBe(
      "Counted toward Rent: -$600.00 (-60000 cents) was due; now paid off, and the upcoming entry is removed.",
    );

    const all = await call("list_bill_or_income_transactions", { id });
    expect(all.split("\n").slice(0, 2)).toEqual([
      "3 transactions tied to this item in all: paid -$925.00 (-92500 cents), upcoming $0.00 (0 cents).",
      "All of them, newest first:",
    ]);
    expect(all).toContain("Rent, part 2");

    const firstPage = await call("list_bill_or_income_transactions", { id, limit: 2 });
    expect(firstPage.split("\n")[1]).toBe("These 2, newest first:");
    const cursor = /before: "([^"]+)"/.exec(firstPage)![1]!;
    const secondPage = await call("list_bill_or_income_transactions", { id, limit: 2, before: cursor });
    expect(secondPage).toContain("Late fee");
    expect(secondPage).not.toContain("There are older ones");

    const lateFee = idIn(extra.split("\n")[0]!);
    expect(await call("update_transaction", { id: lateFee, billIncomeId: null })).not.toContain("bill or income");
    expect(await call("list_bill_or_income_transactions", { id })).toMatch(/^2 transactions tied/);
  });

  it("turns a bill that was really a savings account into a transfer, and gives its balance", async () => {
    // Entered before transfers existed: a bill with no schedule, and money sent to it.
    const bill = { name: "Taxes savings", kind: "expense", defaultAmountCents: 0, recurrenceUnit: "none" };
    const id = idIn(await call("create_bill_or_income", { ...bill, dryRun: false }));
    await call("create_transaction", row("2026-01-14", { name: "To taxes", amountCents: 40_000, paid: true, billIncomeId: id }));
    expect((await call("list_bill_or_income_transactions", { id })).split("\n")[1]).toBe("All of them, newest first:");

    const changed = await call("update_bill_or_income", { id, kind: "transfer", openingCents: 250_000 });
    expect(changed).toMatch(
      /^Changed: Taxes savings \| transfer \| no usual amount \| No schedule \| starting balance \$2,500\.00 \(250000 cents\) \| id [\w-]+\nTransactions that already exist are as they were\.$/,
    );

    // Money coming back is an income tied to the same item.
    await call("create_transaction", row("2026-01-20", { name: "From taxes", kind: "income", amountCents: 100_000, paid: true, billIncomeId: id }));
    expect((await call("list_bill_or_income_transactions", { id })).split("\n").slice(0, 2)).toEqual([
      "2 transactions tied to this item in all: paid $600.00 (60000 cents), upcoming $0.00 (0 cents).",
      "Sent to it $400.00 (40000 cents), brought back $1,000.00 (100000 cents), balance $1,900.00 (190000 cents): " +
        "its starting balance, plus what was sent, less what came back, paid transactions only.",
    ]);

    // A balance belongs to a transfer: going back to a bill has to give it up.
    const refused = await call("update_bill_or_income", { id, kind: "expense" }).catch((caught: unknown) => caught);
    expect(failureText(refused)).toContain("- openingCents: Only a transfer has a starting balance");
    expect(await call("update_bill_or_income", { id, kind: "expense", openingCents: 0 })).toMatch(/^Changed: Taxes savings \| expense \| /);
  });
});

describe("categories and limits", () => {
  const idIn = (text: string) => /\| id ([\w-]+)/.exec(text)![1]!;
  const periodId = async (date: string) => /\| id ([\w-]+)/.exec(await call("get_period", { date }))![1]!;

  it("adds, lists, changes and deletes a category", async () => {
    expect(await call("list_categories")).toBe("No categories yet.");

    const added = await call("create_category", { name: "Groceries", defaultLimitCents: 20_000 });
    expect(added).toMatch(/^Added: Groceries \| usual limit \$200\.00 \(20000 cents\) each pay period \| id [\w-]+$/);
    const id = idIn(added);
    await call("create_category", { name: "Car" });
    expect((await call("list_categories")).split("\n")).toEqual([
      "2 categories:",
      expect.stringMatching(/^- Car \| no usual limit \| id [\w-]+$/),
      `- Groceries | usual limit $200.00 (20000 cents) each pay period | id ${id}`,
    ]);

    expect(await call("update_category", { id, name: "Food", defaultLimitCents: null })).toBe(
      `Changed: Food | no usual limit | id ${id}`,
    );
    await expect(call("update_category", { id })).rejects.toThrow("Give at least one field to change.");
    await expect(call("create_category", { name: "food" })).rejects.toThrow("You already have a category with that name");

    expect(await call("delete_category", { id })).toBe(
      `Deleted category ${id}. What was filed under it remains, with no category.`,
    );
    await expect(call("delete_category", { id })).rejects.toThrow("No such category");
  });

  it("moves everything under a category to another, and merges them when asked", async () => {
    const groceries = idIn(await call("create_category", { name: "Groceries" }));
    const food = idIn(await call("create_category", { name: "Food" }));
    await call("create_transaction", row("2026-01-14", { categoryId: groceries }));
    await call("create_transaction", row("2026-01-15", { categoryId: groceries }));

    expect(await call("move_category", { id: groceries, toCategoryId: food })).toBe(
      `Moved 2 transactions and 0 bills and income from category ${groceries} to category ${food}.`,
    );
    expect(await call("move_category", { id: groceries, toCategoryId: food, deleteAfter: true })).toBe(
      `Moved 0 transactions and 0 bills and income from category ${groceries} to category ${food}. Deleted category ${groceries}.`,
    );
    expect(await call("list_categories")).toMatch(/^1 category:\n- Food /);
    const refused = await call("move_category", { id: food, toCategoryId: food }).catch((caught: unknown) => caught);
    expect(failureText(refused)).toContain("- toCategoryId: Choose a different category");
  });

  it("files transactions, and reports a period that has gone over its limit", async () => {
    const id = idIn(await call("create_category", { name: "Groceries", defaultLimitCents: 20_000, applyToPeriods: true }));

    const first = await call("create_transaction", row("2026-01-14", { amountCents: 12_000, categoryId: id }));
    expect(first).toContain(`| category ${id} | id `);
    const upcoming = await call("create_transaction", row("2026-01-20", { amountCents: 9_500, paid: false, categoryId: id }));
    const unfiled = await call("create_transaction", row("2026-01-21", { amountCents: 70_000 }));
    expect(unfiled).not.toContain("category");

    const report = await call("get_period");
    expect(report).toContain(
      "1 category limit (spent is money out less money in, paid and upcoming, filed under the category):\n" +
        `- Groceries: spent $215.00 (21500 cents) of $200.00 (20000 cents), $120.00 (12000 cents) of it paid | category ${id}\n` +
        "OVER: You're set to go over your budget for Groceries by $15.00 this period.",
    );
    expect(report).toContain(`| paid | Groceries | category ${id} | id `);

    await call("update_transaction", { id: /\| id ([\w-]+)$/m.exec(upcoming)![1]!, status: "paid" });
    expect(await call("get_period")).toContain("OVER: You went over your budget for Groceries by $15.00 this period.");

    // Unfiled, it no longer counts.
    const changed = await call("update_transaction", { id: /\| id ([\w-]+)$/m.exec(first)![1]!, categoryId: null });
    expect(changed).not.toContain("category");
    const after = await call("get_period");
    expect(after).toContain("- Groceries: spent $95.00 (9500 cents) of $200.00 (20000 cents)");
    expect(after).not.toContain("OVER");
  });

  it("sets a due date and reports a period with nothing set to pay it", async () => {
    const added = await call("create_bill_or_income", {
      name: "Visa",
      kind: "expense",
      defaultAmountCents: 0,
      recurrenceUnit: "none",
      dueDate: "2026-01-20",
      dryRun: false,
    });
    expect(added).toContain("| Due every month on the 20th (dueDate 2026-01-20, every 1 month) |");
    expect(added).toContain("| next due by 2026-01-20 |");
    const id = /\| id ([\w-]+)$/m.exec(added)![1]!;

    expect(await call("get_period")).toContain(
      `DUE: Visa is due 2026-01-20 and nothing tied to it is dated on or before then | bill or income ${id}`,
    );
    await call("create_transaction", row("2026-01-22", { billIncomeId: id }));
    expect(await call("get_period")).toContain(
      "DUE: Visa is due 2026-01-20 and nothing tied to it is dated on or before then; its next payment is dated 2026-01-22, after it is due",
    );
    await call("create_transaction", row("2026-01-19", { billIncomeId: id }));
    expect(await call("get_period")).not.toContain("DUE:");
  });

  it("gives a past period a limit, changes it and takes it away", async () => {
    const id = idIn(await call("create_category", { name: "Groceries", defaultLimitCents: 20_000, applyToPeriods: true }));
    const past = await periodId("2025-12-20");
    // Asked for or not, a period that is over was given none.
    expect(await call("get_period", { id: past })).toContain("No category limits in this period.");
    await call("create_transaction", row("2025-12-20", { amountCents: 4_000, categoryId: id }));

    expect(await call("set_period_limit", { periodId: past, categoryId: id, limitCents: 3_000 })).toBe(
      [
        "Period 2025-12-16 to 2025-12-29 now has:",
        "1 category limit (spent is money out less money in, paid and upcoming, filed under the category):",
        `- Groceries: spent $40.00 (4000 cents) of $30.00 (3000 cents), $40.00 (4000 cents) of it paid | category ${id}`,
        "OVER: You went over your budget for Groceries by $10.00 this period.",
      ].join("\n"),
    );
    expect(await call("set_period_limit", { periodId: past, categoryId: id, limitCents: 5_000 })).not.toContain("OVER");
    // The current period's own limit, and the usual one, are untouched.
    expect(await call("get_period")).toContain("of $200.00 (20000 cents)");
    expect(await call("list_categories")).toContain("usual limit $200.00 (20000 cents)");

    expect(await call("remove_period_limit", { periodId: past, categoryId: id })).toBe(
      "Removed. Period 2025-12-16 to 2025-12-29 now has:\nNo category limits in this period.",
    );
    await expect(call("remove_period_limit", { periodId: past, categoryId: id })).rejects.toThrow(
      "That period has no limit for that category",
    );
    await expect(call("set_period_limit", { periodId: past, categoryId: "nope", limitCents: 1 })).rejects.toThrow("No such category");
    await expect(call("set_period_limit", { periodId: "nope", categoryId: id, limitCents: 1 })).rejects.toThrow("No such period");
  });

  it("puts a category on a bill or income, and on what is already tied to it when asked", async () => {
    const id = idIn(await call("create_category", { name: "Housing" }));
    const rent = idIn(
      await call("create_bill_or_income", {
        name: "Rent",
        kind: "expense",
        defaultAmountCents: 90_000,
        recurrenceUnit: "month",
        firstDueDate: "2026-01-25",
        dryRun: false,
      }),
    );
    await call("create_transaction", row("2026-01-14", { name: "Late fee", billIncomeId: rent }));

    const quiet = await call("update_bill_or_income", { id: rent, categoryId: id });
    expect(quiet).toContain(`| category ${id} |`);
    expect(quiet).toContain("Transactions that already exist are as they were.");
    expect(await call("list_bills_income")).toContain(`| category ${id} |`);
    expect(await call("get_period")).not.toContain(`| category ${id} | id`);

    // A payment tied to it from now on takes its category without being told to.
    expect(await call("create_transaction", row("2026-01-15", { name: "Top-up", billIncomeId: rent }))).toContain(`| category ${id} | id `);

    const loud = await call("update_bill_or_income", { id: rent, applyToTransactions: true });
    expect(loud).toContain(`2 transactions already tied to it were filed under category ${id}; nothing else about them changed.`);
    const report = await call("get_period");
    expect(report.match(new RegExp(`\\| category ${id} \\| id `, "g"))).toHaveLength(3);
  });

  it("files the rows of an imported file", async () => {
    const id = idIn(await call("create_category", { name: "Groceries" }));
    writeFile([
      row("2026-01-20", { name: "Kroger", importKey: "a", categoryId: id }),
      row("2026-01-21", { name: "Cinema", importKey: "b" }),
    ]);
    await call("import_transactions", { file: FILE, dryRun: false });

    const listed = await call("list_transactions", { from: "2026-01-20", to: "2026-01-21" });
    expect(listed).toContain(`Kroger | imported as "a" | category ${id} | id `);
    expect(listed).toMatch(/Cinema \| imported as "b" \| id /);

    writeFile([row("2026-01-22", { importKey: "c", categoryId: "nope" })]);
    await expect(call("import_transactions", { file: FILE })).rejects.toThrow("categoryId: No such category");
  });
});

describe("searching and reporting", () => {
  it("searches by words, category and dates, across periods", async () => {
    const id = /\| id ([\w-]+)/.exec(await call("create_category", { name: "Groceries" }))![1]!;
    await call("create_transaction", row("2025-12-20", { name: "KROGER #512", amountCents: 5_000, categoryId: id }));
    await call("create_transaction", row("2026-01-14", { name: "Kroger fuel", amountCents: 4_000 }));
    await call("create_transaction", row("2026-01-15", { name: "Refund", amountCents: 700, kind: "income", note: "kroger", categoryId: id }));
    await call("create_transaction", row("2026-01-16", { name: "Cinema" }));

    const found = await call("search_transactions", { q: "kroger" });
    expect(found.split("\n").slice(0, 2)).toEqual([
      "3 transactions found: $90.00 (9000 cents) out, $7.00 (700 cents) in.",
      "All of them, newest first:",
    ]);
    expect(found.split("\n").slice(2).map((line) => line.split(" | ")[3])).toEqual(["Refund", "Kroger fuel", "KROGER #512"]);

    expect(await call("search_transactions", { q: "kroger", categoryId: "none" })).toContain("1 transaction found: $40.00 (4000 cents) out");
    expect(await call("search_transactions", { categoryId: id, from: "2026-01-01" })).toContain("1 transaction found: $0.00 (0 cents) out, $7.00 (700 cents) in.");
    expect(await call("search_transactions", { q: "nothing like it" })).toBe("0 transactions found: $0.00 (0 cents) out, $0.00 (0 cents) in.");

    const paged = await call("search_transactions", { q: "kroger", limit: 2 });
    expect(paged).toContain("These 2, newest first:");
    const cursor = /before: "([^"]+)"/.exec(paged)![1]!;
    expect(await call("search_transactions", { q: "kroger", limit: 2, before: cursor })).toContain("KROGER #512");
    await expect(call("search_transactions", {})).rejects.toThrow("Enter something to search for");
  });

  it("reports a span in words", async () => {
    const id = /\| id ([\w-]+)/.exec(await call("create_category", { name: "Groceries", defaultLimitCents: 3_000, applyToPeriods: true }))![1]!;
    await call("create_transaction", row("2025-12-20", { name: "Kroger", amountCents: 5_000, categoryId: id }));
    await call("create_transaction", row("2026-01-14", { name: "KROGER", amountCents: 4_000, categoryId: id }));
    await call("create_transaction", row("2026-01-14", { name: "Paycheck", amountCents: 200_000, kind: "income" }));
    await call("create_transaction", row("2026-01-13", { name: "Gift", amountCents: 1_000, paid: false }));

    const text = await call("get_report", { from: "2025-12-16", to: "2026-01-26" });
    expect(text).toContain("Report for 3 pay periods, 2025-12-16 to 2026-01-26.");
    expect(text).toContain("Income $2,000.00 (200000 cents), expenses $100.00 (10000 cents), income less expenses $1,900.00 (190000 cents).");
    expect(text).toContain("- 2025-12-16 to 2025-12-29: $0.00 (0 cents) | $50.00 (5000 cents) | $0.00 (0 cents) | $950.00 (95000 cents)");
    expect(text).toContain("- 2026-01-13 to 2026-01-26 (current): $2,000.00 (200000 cents) | $50.00 (5000 cents) | $0.00 (0 cents) | $2,900.00 (290000 cents)");
    expect(text).toContain("- Groceries: $90.00 (9000 cents)\n- Uncategorised: $10.00 (1000 cents)");
    expect(text).toContain("- Not tied to a bill: $100.00 (10000 cents)");
    expect(text).toContain("- 2026-01-13 to 2026-01-26: Groceries over by $10.00 (1000 cents) (spent $40.00 (4000 cents) of $30.00 (3000 cents))");
    expect(text).toContain("- KROGER: $90.00 (9000 cents) in 2 transactions");
    expect(text).toContain("1 transaction dated before today is still marked upcoming:");

    expect(await call("get_report", { from: "2024-01-01", to: "2024-02-01" })).toBe("No pay period falls between 2024-01-01 and 2024-02-01.");
    await expect(call("get_report", { from: "2026-02-01", to: "2026-01-01" })).rejects.toThrow();
  });
});

describe("links in an imported file", () => {
  let rentId: string;
  let dueId: string;

  beforeEach(async () => {
    const created = await session.post("/api/bills-income", {
      name: "Rent",
      kind: "expense",
      defaultAmountCents: 90_000,
      recurrenceUnit: "month",
      firstDueDate: "2026-01-25",
    });
    rentId = (await created.json()).item.id;
    const due = (await (await session.get("/api/transactions?from=2026-01-25&to=2026-01-25")).json()).transactions[0];
    dueId = due.id;
  });

  it("suggests the item for each row and says exactly what to add to accept it", async () => {
    // Something the import can learn from: a card payment tied by hand earlier.
    const card = await (
      await session.post("/api/bills-income", { name: "Credit card", kind: "expense", defaultAmountCents: 20_000, recurrenceUnit: "month", firstDueDate: "2026-06-05" })
    ).json();
    await call("create_transaction", row("2026-01-02", { name: "Card", note: "CAPITAL ONE MOBILE PMT", billIncomeId: card.item.id }));

    writeFile([
      row("2026-01-26", { name: "ACH LANDLORD LLC", amountCents: 90_000, importKey: "a" }),
      row("2026-01-21", { name: "Card", amountCents: 4200, note: "capital one mobile pmt", importKey: "b" }),
      row("2026-01-22", { name: "Rent parking add-on", amountCents: 1500, importKey: "c" }),
      row("2026-01-23", { name: "Groceries", importKey: "d" }),
    ]);

    const report = await call("import_transactions", { file: FILE });
    const lines = report.split("\n");
    const at = lines.findIndex((line) => line.startsWith("3 rows look like they belong to a bill or income"));
    expect(lines[at]).toBe(
      "3 rows look like they belong to a bill or income. Nothing is tied unless the row says so: for each one that is right, add what is shown to the row.",
    );
    expect(lines.slice(at + 1, at + 4)).toEqual([
      `- row 0 2026-01-26 "ACH LANDLORD LLC" → Rent: it matches the upcoming entry that item added. Add "countsToward": "${dueId}"`,
      `- row 1 2026-01-21 "Card" → Credit card: an earlier transaction tied to that item has the same description. Add "billIncomeId": "${card.item.id}"`,
      `- row 2 2026-01-22 "Rent parking add-on" → Rent: the item's name appears in it. Add "billIncomeId": "${rentId}"`,
    ]);
    // The row that matches the expected rent is not also listed as a possible duplicate.
    expect(report).not.toContain("may repeat a transaction");
    expect(await saved()).toHaveLength(2);
  });

  it("reports what paying toward an entry does, and imports it", async () => {
    writeFile([
      row("2026-01-20", { name: "Rent, first half", amountCents: 45_000, countsToward: dueId, importKey: "a" }),
      row("2026-01-22", { name: "Rent extra", amountCents: 1000, billIncomeId: rentId, importKey: "b" }),
    ]);

    const preview = await call("import_transactions", { file: FILE });
    expect(preview).toContain(
      "Upcoming entries that would be paid toward:\n- Rent: -$900.00 (-90000 cents) was due; -$450.00 (-45000 cents) is still upcoming",
    );
    // Half of the rent moved from upcoming to paid; only the extra $10 is new spending.
    expect(preview).toContain("- Projected leftover: $100.00 (10000 cents) → $90.00 (9000 cents)");
    expect(preview).not.toContain("look like");

    const done = await call("import_transactions", { file: FILE, dryRun: false });
    expect(done).toContain("Upcoming entries paid toward:\n- Rent: -$900.00 (-90000 cents) was due; -$450.00 (-45000 cents) is still upcoming");
    const listed = await call("list_bill_or_income_transactions", { id: rentId });
    expect(listed).toMatch(/^3 transactions tied to this item in all: paid -\$460\.00 \(-46000 cents\), upcoming -\$450\.00 \(-45000 cents\)\./);
  });

  it("adds up payments toward one entry that fall in different requests", async () => {
    // Rows 0 and 600 are sent in different requests; each pays a third of the rent.
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 150 }, (_, index) =>
      row("2026-01-14", { amountCents: 1, importKey: `bulk-${index}` }),
    );
    rows[0] = row("2026-01-20", { name: "Rent 1 of 3", amountCents: 30_000, countsToward: dueId, importKey: "part-1" });
    rows[600] = row("2026-01-21", { name: "Rent 2 of 3", amountCents: 30_000, countsToward: dueId, importKey: "part-2" });
    writeFile(rows);
    const expected = "- Rent: -$900.00 (-90000 cents) was due; -$300.00 (-30000 cents) is still upcoming";

    const preview = await call("import_transactions", { file: FILE });
    expect(preview).toContain(`Upcoming entries that would be paid toward:\n${expected}`);
    const done = await call("import_transactions", { file: FILE, dryRun: false });
    expect(done).toContain(`Upcoming entries paid toward:\n${expected}`);

    const due = (await (await session.get("/api/transactions?from=2026-01-25&to=2026-01-25")).json()).transactions[0];
    expect(due).toMatchObject({ id: dueId, amountCents: -30_000, status: "upcoming" });
  });

  it("names the row whose link cannot be made", async () => {
    writeFile([row("2026-01-20"), row("2026-01-21", { name: "Wrong", billIncomeId: "no-such-id" })]);
    const error = await call("import_transactions", { file: FILE, dryRun: false }).catch((caught: unknown) => caught);
    expect((error as Error).message.split("\n").slice(0, 2)).toEqual([
      "The server would refuse 1 row of 2. Nothing was imported.",
      "- row 1 (2026-01-21 Wrong): billIncomeId: No such bill or income",
    ]);
  });
});

describe("the token", () => {
  it("names the account it belongs to", async () => {
    expect(await whoAmI(api)).toBe("ann");
  });

  it("fails with what to do when the server refuses it", async () => {
    connect("ppb_not-a-real-token");
    await expect(whoAmI(api)).rejects.toThrow(
      "The server refused the API token. It may have been revoked or have expired; create a new one in the app's Settings.",
    );
    await expect(call("get_budget")).rejects.toThrow("refused the API token");
  });

  it("passes on the reason when the server has API tokens turned off", async () => {
    // The same budget behind a server started with ALLOW_API_TOKENS=false.
    const secret = await newToken("write");
    const { app } = createApp({ store: t.store, config: { ...t.config, allowApiTokens: false }, now: t.clock.now });
    const live = t.app;
    t.app = app;
    try {
      connect(secret);
      // Not "revoked or expired": the token is fine, and a new one would not help.
      await expect(whoAmI(api)).rejects.toThrow("API tokens are turned off on this server");
      await expect(call("get_budget")).rejects.toThrow("API tokens are turned off on this server");
      await expect(call("create_transaction", row("2026-01-20"))).rejects.toThrow("API tokens are turned off on this server");
    } finally {
      t.app = live;
    }
    expect(await saved()).toEqual([]);
  });

  it("can read but not write when it is read-only", async () => {
    connect(await newToken("read"));
    expect(await call("get_period")).toContain("the current period");

    writeFile([row("2026-01-20")]);
    for (const attempt of [
      call("create_transaction", row("2026-01-20")),
      call("import_transactions", { file: FILE }),
      call("import_transactions", { file: FILE, dryRun: false }),
    ]) {
      await expect(attempt).rejects.toThrow("This API token is read-only");
    }
    expect(await saved()).toEqual([]);
  });

  it("only ever sees its own user's budget", async () => {
    const bob = t.client();
    await bob.post("/api/auth/register", { username: "bob", email: "bob@example.com", password: "correct horse" });
    await bob.post("/api/budget", { type: "weekly", anchorDate: "2026-01-12", openingCents: 5, timezone: "UTC" });
    await bob.post("/api/transactions", row("2026-01-14", { name: "Bob's" }));

    expect(await call("get_budget")).toContain("Account: ann");
    expect(await call("list_transactions", { from: "2026-01-01", to: "2026-01-31" })).toContain("0 transactions");
  });

  it("says so when the server cannot be reached", async () => {
    failWhen = () => true;
    await expect(call("get_budget")).rejects.toThrow("Couldn't reach the budget server at https://budget.test (socket hang up).");
  });
});

describe("over the protocol", () => {
  async function connectClient() {
    const server = buildMcpServer({ api, readFile: async (path) => files[path] ?? "", now: t.clock.now });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    return client;
  }
  const textOf = (result: unknown) => (result as { content: Array<{ text: string }> }).content[0]!.text;

  it("offers every tool, marked by whether it changes anything", async () => {
    const client = await connectClient();
    const { tools: offered } = await client.listTools();

    expect(offered.map((tool) => [tool.name, tool.annotations?.readOnlyHint, tool.annotations?.destructiveHint])).toEqual([
      ["get_budget", true, false],
      ["list_periods", true, false],
      ["get_period", true, false],
      ["list_transactions", true, false],
      ["search_transactions", true, false],
      ["get_report", true, false],
      ["create_transaction", false, false],
      ["update_transaction", false, false],
      ["delete_transaction", false, true],
      ["list_bills_income", true, false],
      ["list_bill_or_income_transactions", true, false],
      ["create_bill_or_income", false, false],
      ["update_bill_or_income", false, false],
      ["end_bill_or_income", false, true],
      ["delete_bill_or_income", false, true],
      ["list_categories", true, false],
      ["create_category", false, false],
      ["update_category", false, false],
      ["move_category", false, true],
      ["delete_category", false, true],
      ["set_period_limit", false, false],
      ["remove_period_limit", false, false],
      ["import_transactions", false, false],
    ]);
    const createTool = offered.find((tool) => tool.name === "create_bill_or_income")!;
    expect(createTool.inputSchema.required).toEqual(["name", "kind", "defaultAmountCents", "recurrenceUnit"]);
    const importTool = offered.find((tool) => tool.name === "import_transactions")!;
    expect(importTool.inputSchema.required).toEqual(["file"]);
    expect(Object.keys(importTool.inputSchema.properties ?? {})).toEqual([
      "file",
      "dryRun",
      "addEarlierPeriods",
      "restoreDeleted",
    ]);
    expect(client.getInstructions()).toContain("integer cents");
  });

  it("runs a tool and returns its text", async () => {
    const client = await connectClient();
    const result = await client.callTool({ name: "get_budget", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("Pay schedule: biweekly");
  });

  it("returns a failure as an error result with the reason, not a protocol error", async () => {
    const client = await connectClient();
    const result = await client.callTool({ name: "get_period", arguments: { date: "2030-01-01" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("No pay period covers 2030-01-01.");

    const refused = await client.callTool({ name: "create_transaction", arguments: row("2024-01-20") });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toBe("That's before your budget started\n- occursAt: That's before your budget started");
  });
});

describe("configuration", () => {
  const good = { PPB_URL: "https://budget.example.com/", PPB_TOKEN: " ppb_abc " };

  it("reads the address and token, tidied", () => {
    expect(readConfig(good)).toEqual({ baseUrl: "https://budget.example.com", token: "ppb_abc" });
    expect(readConfig({ ...good, PPB_URL: "http://localhost:8787" }).baseUrl).toBe("http://localhost:8787");
    expect(readConfig({ ...good, PPB_URL: "https://example.com/budget/" }).baseUrl).toBe("https://example.com/budget");
  });

  it.each([
    ["no address", { ...good, PPB_URL: undefined }, "PPB_URL is not set"],
    ["no token", { ...good, PPB_TOKEN: "" }, "PPB_TOKEN is not set"],
    ["something that isn't an address", { ...good, PPB_URL: "budget" }, "PPB_URL is not an address"],
    ["another scheme", { ...good, PPB_URL: "ftp://budget.example.com" }, "must start with https://"],
    ["plain HTTP to another machine", { ...good, PPB_URL: "http://budget.example.com" }, "would send the token unencrypted"],
    ["a password instead of a token", { ...good, PPB_TOKEN: "hunter2" }, "does not look like an API token"],
  ])("refuses %s", (_label, env, message) => {
    expect(() => readConfig(env)).toThrow(ConfigError);
    expect(() => readConfig(env)).toThrow(message);
  });
});
