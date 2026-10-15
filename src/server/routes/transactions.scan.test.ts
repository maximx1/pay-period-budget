import { afterEach, describe, expect, it } from "vitest";
import type { OcrWord, ScanResponse } from "../../shared/scan.ts";
import type { OcrEngine } from "../lib/ocr.ts";
import { createTestApp, type TestApp } from "../testing.ts";

// The test clock starts at 2026-01-15T12:00Z. The reader is a stand-in that returns the
// words it is given, so these tests are about the endpoint; shared/scan.test.ts is about
// reading layouts, and lib/ocr.test.ts runs tesseract itself.

/** Two transactions as a phone app shows them: name and amount, then date and balance. */
function word(x: number, y: number, text: string, confidence = 95): OcrWord {
  return { text, x0: x, y0: y, x1: x + text.length * 20, y1: y + 36, confidence };
}
const PHONE: OcrWord[] = [
  word(70, 500, "CORNER"),
  word(220, 500, "MARKET"),
  word(900, 500, "-$6.78"),
  word(70, 556, "Jan"),
  word(150, 556, "9"),
  word(900, 556, "$1,400.00"),
  word(70, 760, "PAYROLL"),
  word(900, 760, "$2,000.00"),
  word(70, 816, "Jan"),
  word(150, 816, "9,"),
  word(200, 816, "2026"),
  word(900, 816, "$1,406.78"),
];
const PNG: Uint8Array<ArrayBuffer> = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function fakeReader(words: OcrWord[] | Error = PHONE) {
  const reads: Uint8Array[] = [];
  const engine: OcrEngine = {
    async read(image) {
      reads.push(image);
      if (words instanceof Error) throw words;
      return words;
    },
    async close() {},
  };
  return { engine, reads };
}

/** A stand-in for an OpenAI-compatible server, answering with `content` (or a status, or never). */
function fakeModel(answer: string | number | "hang") {
  const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const impl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string>, body: JSON.parse(String(init?.body)) });
    if (answer === "hang") {
      return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("timeout"), { name: "TimeoutError" }))));
    }
    if (typeof answer === "number") return new Response("nope", { status: answer });
    return new Response(JSON.stringify({ choices: [{ message: { content: answer } }] }), { status: 200 });
  };
  return { impl, calls };
}

let t: TestApp;
afterEach(() => t.cleanup());

async function signUp(budget = true) {
  const client = t.client();
  await client.post("/api/auth/register", { username: "ann", email: "ann@example.com", password: "correct horse" });
  if (budget) await client.post("/api/budget", { type: "biweekly", anchorDate: "2025-12-16", openingCents: 100_000, timezone: "UTC" });
  return client;
}

async function scan(client: ReturnType<TestApp["client"]>, bytes: Uint8Array<ArrayBuffer> = PNG, name = "shot.png") {
  const form = new FormData();
  form.append("image", new File([bytes], name, { type: "image/png" }));
  return client.post("/api/transactions/scan", form);
}

const model = { SCAN_MODEL_URL: "http://models.local:11434/v1/", SCAN_MODEL: "reader-7b" };

describe("reading a screenshot", () => {
  it("reports the transactions the built-in reader finds, dated by the budget's today, and saves nothing", async () => {
    const reader = fakeReader();
    t = await createTestApp({}, { ocr: reader.engine });
    const ann = await signUp();

    const response = await scan(ann);
    expect(response.status).toBe(200);
    const body: ScanResponse = await response.json();
    expect(body).toMatchObject({ reader: "built_in", notice: null });
    expect(body.rows.map(({ date, name, amountCents, balanceCents, flags }) => ({ date, name, amountCents, balanceCents, flags }))).toEqual([
      // "Jan 9" without a year: the latest that is not after today, 2026-01-15.
      { date: "2026-01-09", name: "CORNER MARKET", amountCents: -678, balanceCents: 140_000, flags: [] },
      { date: "2026-01-09", name: "PAYROLL", amountCents: 200_000, balanceCents: 140_678, flags: [] },
    ]);
    expect(reader.reads).toHaveLength(1);
    expect((await (await ann.get("/api/transactions/search?q=market")).json()).totals.count).toBe(0);
  });

  it("refuses what isn't a picture, no picture, one too large, and one the reader can't read", async () => {
    const reader = fakeReader();
    t = await createTestApp({}, { ocr: reader.engine });
    const ann = await signUp();

    const notPicture = await scan(ann, new TextEncoder().encode("hello, not a png"), "shot.png");
    expect(notPicture.status).toBe(400);
    expect((await notPicture.json()).error.message).toMatch(/PNG, JPEG or WebP/);

    const empty = await ann.post("/api/transactions/scan", new FormData());
    expect(empty.status).toBe(400);
    expect((await empty.json()).error.fields).toEqual({ image: "Choose a screenshot" });

    const huge = new Uint8Array(10 * 1024 * 1024 + 1);
    huge.set(PNG);
    expect((await scan(ann, huge)).status).toBe(413);
    expect(reader.reads).toHaveLength(0);

    t.cleanup();
    t = await createTestApp({}, { ocr: fakeReader(new Error("bad image")).engine });
    const bob = await signUp();
    const unreadable = await scan(bob);
    expect(unreadable.status).toBe(400);
    expect((await unreadable.json()).error.message).toMatch(/couldn't be read/);
  });

  it("is only for someone signed in with a budget of their own", async () => {
    const reader = fakeReader();
    t = await createTestApp({}, { ocr: reader.engine });
    expect((await scan(t.client())).status).toBe(401);
    const noBudget = await signUp(false);
    expect((await scan(noBudget)).status).toBeGreaterThanOrEqual(400);
    expect(reader.reads).toHaveLength(0);
  });
});

describe("reading a screenshot with the owner's own model", () => {
  const answer = "```json\n" + JSON.stringify({
    transactions: [
      { date: "2026-01-09", description: " Corner  Market ", amount: -6.78, balance: 1400 },
      { date: null, description: "", amount: 2000, balance: null },
    ],
  }) + "\n```";

  it("sends it the text the built-in reader found and believes its checked answer", async () => {
    const remote = fakeModel(answer);
    t = await createTestApp({ ...model, SCAN_MODEL_KEY: "sk-local" }, { ocr: fakeReader().engine, fetch: remote.impl });
    const body: ScanResponse = await (await scan(await signUp())).json();

    expect(body).toMatchObject({ reader: "model", notice: null });
    expect(body.rows).toEqual([
      { date: "2026-01-09", name: "Corner Market", amountCents: -678, balanceCents: 140_000, confidence: 100, flags: [] },
      { date: null, name: "", amountCents: 200_000, balanceCents: null, confidence: 100, flags: ["hard_to_read", "no_date"] },
    ]);
    const [call] = remote.calls;
    expect(call!.url).toBe("http://models.local:11434/v1/chat/completions");
    expect(call!.headers.Authorization).toBe("Bearer sk-local");
    expect(call!.body.model).toBe("reader-7b");
    const userMessage = (call!.body.messages as Array<{ role: string; content: unknown }>)[1]!.content as string;
    expect(userMessage).toContain("Today is 2026-01-15");
    expect(userMessage).toContain("CORNER MARKET | -$6.78");
  });

  it("sends the picture itself to a model that can see", async () => {
    const remote = fakeModel(answer);
    t = await createTestApp({ ...model, SCAN_MODEL_IMAGES: "true" }, { ocr: fakeReader().engine, fetch: remote.impl });
    await scan(await signUp());
    const content = (remote.calls[0]!.body.messages as Array<{ content: unknown }>)[1]!.content as Array<Record<string, unknown>>;
    expect(content[1]).toEqual({ type: "image_url", image_url: { url: `data:image/png;base64,${Buffer.from(PNG).toString("base64")}` } });
    expect(remote.calls[0]!.headers.Authorization).toBeUndefined();
  });

  it.each<[string, string | number | "hang", RegExp]>([
    ["an error", 500, /answered with an error \(500\)/],
    ["no JSON", "I could not read that, sorry.", /held no JSON/],
    ["the wrong shape", JSON.stringify({ rows: [] }), /not in the expected form/],
    ["nothing in time", "hang", /took too long/],
  ])("falls back to the built-in reader when the model gives %s, and says so", async (_, reply, why) => {
    const remote = fakeModel(reply);
    t = await createTestApp({ ...model, SCAN_MODEL_TIMEOUT_SECONDS: "5" }, { ocr: fakeReader().engine, fetch: remote.impl });
    if (reply === "hang") t.config.scanModel!.timeoutMs = 20;
    const body: ScanResponse = await (await scan(await signUp())).json();
    expect(body.reader).toBe("built_in");
    expect(body.notice).toMatch(why);
    expect(body.rows.map((row) => row.name)).toEqual(["CORNER MARKET", "PAYROLL"]);
  });

  it("is not asked while SCAN_MODEL_ENABLED is false, though its settings stay", async () => {
    const remote = fakeModel(answer);
    t = await createTestApp({ ...model, SCAN_MODEL_ENABLED: "false" }, { ocr: fakeReader().engine, fetch: remote.impl });
    const body: ScanResponse = await (await scan(await signUp())).json();
    expect(body.reader).toBe("built_in");
    expect(remote.calls).toHaveLength(0);
  });
});
