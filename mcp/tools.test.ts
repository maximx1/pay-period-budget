import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

  it("lists transactions by date with their origin, and recurring items", async () => {
    const created = await session.post("/api/recurring", {
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
      /^- 2026-01-25 00:00 \| -\$900\.00 \(-90000 cents\) \| upcoming \| Rent \| generated from a recurring item \| id [\w-]+$/,
    );
    await expect(call("list_transactions", { from: "2026-01-01", to: "2028-01-01" })).rejects.toThrow(ApiRequestError);

    expect(await call("list_recurring")).toMatch(
      /^1 recurring item:\n- Rent \| -\$900\.00 \(-90000 cents\) each time \| .+ \| first due 2026-01-25 \| next due 2026-01-25 \| description: to the landlord \| id [\w-]+$/,
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
      ["create_transaction", false, false],
      ["update_transaction", false, false],
      ["delete_transaction", false, true],
      ["list_recurring", true, false],
      ["import_transactions", false, false],
    ]);
    const importTool = offered.find((tool) => tool.name === "import_transactions")!;
    expect(importTool.inputSchema.required).toEqual(["file"]);
    expect(Object.keys(importTool.inputSchema.properties ?? {})).toEqual(["file", "dryRun", "addEarlierPeriods"]);
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
