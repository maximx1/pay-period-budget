import { afterEach, describe, expect, it } from "vitest";
import { ADVICE_QUESTIONS } from "../../shared/advice.ts";
import { createTestApp, type TestApp } from "../testing.ts";

// The test clock starts at 2026-01-15T12:00Z. Biweekly from 2025-12-16, the current pay
// period is 2026-01-13..01-26.

type Call = { url: string; headers: Record<string, string>; body: { messages: Array<{ role: string; content: string }>; [key: string]: unknown } };

/** A stand-in for an OpenAI-compatible server, answering with `content` (or a status, or never). */
function fakeModel(answer: string | number | "hang") {
  const calls: Call[] = [];
  const impl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string>, body: JSON.parse(String(init?.body)) });
    if (answer === "hang") {
      return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("timeout"), { name: "TimeoutError" }))));
    }
    if (typeof answer === "number") return new Response("nope", { status: answer });
    return new Response(JSON.stringify({ choices: [{ message: { content: answer } }] }), { status: 200 });
  };
  const system = () => calls.at(-1)!.body.messages[0]!.content;
  const user = () => calls.at(-1)!.body.messages[1]!.content;
  return { impl, calls, system, user };
}

const ON = { ADVICE_ENABLED: "true", ADVICE_MODEL_URL: "http://models.local/v1/", ADVICE_MODEL: "adviser", ADVICE_MODEL_KEY: "sk-advice" };

let t: TestApp;
type Client = ReturnType<TestApp["client"]>;
afterEach(() => t.cleanup());

async function signUp(name: string, budget = true): Promise<Client> {
  const client = t.client();
  await client.post("/api/auth/register", { username: name, email: `${name}@example.com`, password: "correct horse" });
  if (budget) {
    const setup = await client.post("/api/budget", { type: "biweekly", anchorDate: "2025-12-16", openingCents: 100_000, timezone: "UTC" });
    expect(setup.status).toBe(201);
  }
  return client;
}

const ask = (client: Client, questionId = "make-it-to-payday") => client.post("/api/advice", { questionId });

describe("the Advice switch", () => {
  it("is off unless turned on and given a model, and says so to the signed-out client too", async () => {
    const offs: Array<Record<string, string>> = [{}, { ADVICE_ENABLED: "true" }, { ADVICE_MODEL_URL: ON.ADVICE_MODEL_URL, ADVICE_MODEL: ON.ADVICE_MODEL }];
    for (const env of offs) {
      t = await createTestApp(env, { fetch: fakeModel("Fine.").impl });
      expect((await (await t.client().get("/api/auth/config")).json()).adviceEnabled).toBe(false);
      const ann = await signUp("ann");
      for (const response of [await ann.get("/api/advice"), await ask(ann), await ann.put("/api/advice/persona", { persona: "plain" })]) {
        expect(response.status).toBe(403);
        expect((await response.json()).error.message).toBe("Advice is turned off on this server");
      }
      t.cleanup();
    }
    t = await createTestApp(ON, { fetch: fakeModel("Fine.").impl });
    expect((await (await t.client().get("/api/auth/config")).json()).adviceEnabled).toBe(true);
  });

  it("uses the screenshot model's address when advice has none of its own, even with screenshot reading off", async () => {
    const model = fakeModel("Yes.");
    t = await createTestApp(
      { ADVICE_ENABLED: "true", SCAN_MODEL_URL: "http://scan.local/v1", SCAN_MODEL: "reader", SCAN_MODEL_ENABLED: "false" },
      { fetch: model.impl },
    );
    expect((await ask(await signUp("ann"))).status).toBe(200);
    expect(model.calls[0]!.url).toBe("http://scan.local/v1/chat/completions");
    expect(model.calls[0]!.body.model).toBe("reader");
  });
});

describe("asking a question", () => {
  it("lists the questions in their groups, with the plain voice to start", async () => {
    t = await createTestApp(ON, { fetch: fakeModel("Fine.").impl });
    const response = await (await signUp("ann")).get("/api/advice");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.persona).toEqual({ persona: "plain", custom: null });
    expect(body.groups.map((group: { title: string }) => group.title)).toEqual(["This pay period", "Habits", "Bills and the months ahead"]);
    expect(body.groups.flatMap((group: { questions: unknown[] }) => group.questions)).toEqual(
      ADVICE_QUESTIONS.map(({ id, label }) => ({ id, label })),
    );
  });

  it("sends the rules, the question and the worked-out figures in one request, and returns the answer tidied", async () => {
    const model = fakeModel("<think>Let me add this up.</think>\n**Yes**, with $812.40 to spare.\n* Rent lands on the 25th.");
    t = await createTestApp(ON, { fetch: model.impl });
    const ann = await signUp("ann");
    const groceries = (await (await ann.post("/api/categories", { name: "Groceries", defaultLimitCents: 20_000, applyToPeriods: true })).json()).category;
    await ann.post("/api/transactions", { name: "Kroger", amountCents: 12_345, kind: "expense", occursAt: "2026-01-14T10:00", paid: true, categoryId: groceries.id });
    await ann.post("/api/bills-income", {
      name: "Rent",
      kind: "expense",
      defaultAmountCents: 90_000,
      recurrenceUnit: "month",
      recurrenceInterval: 1,
      firstDueDate: "2026-01-25",
    });

    const response = await ask(ann);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      questionId: "make-it-to-payday",
      answer: "Yes, with $812.40 to spare.\n- Rent lands on the 25th.",
      askedAt: "2026-01-15T12:00:00.000Z",
    });

    expect(model.calls).toHaveLength(1);
    const [call] = model.calls;
    expect(call!.url).toBe("http://models.local/v1/chat/completions");
    expect(call!.headers.Authorization).toBe("Bearer sk-advice");
    expect(call!.body).toMatchObject({ model: "adviser", max_tokens: 350 });
    expect(model.system()).toContain("At most 80 words");
    expect(model.system()).not.toContain("voice");
    const user = model.user();
    expect(user).toMatch(/^Question: Will I make it to payday\?\nWhat to look at: /);
    expect(user).toContain("Today is 2026-01-15. Paid every two weeks.");
    expect(user).toContain("CURRENT PAY PERIOD Jan 13 – Jan 26, 2026: day 3 of 14, 12 days left including today.");
    expect(user).toContain("2026-01-25 Rent: -$900.00");
    // The opening $1,000 carried in; Kroger and Rent take $1,023.45 of it: nothing to spare per day.
    expect(user).toContain("Projected leftover on payday: -$23.45, which is $1,023.45 less than the period started with.");
    expect(user).toContain("and still end no lower than the period started: nothing.");
    expect(user).toContain("Groceries: $123.45 of $200.00");
    expect(user).toMatch(/- Rent: bill; Every month on the 25th; usual \$900\.00; \$10,800\.00 a year as scheduled/);
  });

  it("answers in the chosen voice, and keeps a voice of the owner's own words", async () => {
    const model = fakeModel("Righto.");
    t = await createTestApp(ON, { fetch: model.impl });
    const ann = await signUp("ann");

    const banker = await ann.put("/api/advice/persona", { persona: "british-banker" });
    expect(await banker.json()).toEqual({ persona: { persona: "british-banker", custom: null } });
    await ask(ann);
    expect(model.system()).toContain("Answer in the voice of a dry, well-spoken British bank manager");

    const nameless = await ann.put("/api/advice/persona", { persona: "custom", custom: "  " });
    expect(nameless.status).toBe(400);
    expect((await nameless.json()).error.fields).toEqual({ custom: "Say who should answer" });

    await ann.put("/api/advice/persona", { persona: "custom", custom: "a pirate who hates waste" });
    expect((await (await ann.get("/api/advice")).json()).persona).toEqual({ persona: "custom", custom: "a pirate who hates waste" });
    await ask(ann);
    expect(model.system()).toContain("Answer in the voice of a pirate who hates waste.");

    // Words given with a voice that isn't "your own" are not kept.
    expect(await (await ann.put("/api/advice/persona", { persona: "buddy", custom: "ignored" })).json()).toEqual({
      persona: { persona: "buddy", custom: null },
    });
    expect((await ann.put("/api/advice/persona", { persona: "shakespeare" })).status).toBe(400);
  });

  it("refuses a question it doesn't have, and a budget not set up", async () => {
    t = await createTestApp(ON, { fetch: fakeModel("Fine.").impl });
    const ann = await signUp("ann");
    expect((await ask(ann, "lottery-numbers")).status).toBe(400);
    const bob = await signUp("bob", false);
    expect((await ask(bob)).status).toBe(409);
    expect((await bob.put("/api/advice/persona", { persona: "oscar" })).status).toBe(409);
  });

  it.each([
    [500, "The adviser couldn't answer: it answered with an error (500)."],
    ["   ", "The adviser couldn't answer: it said nothing."],
    ["hang", "The adviser couldn't answer: it took too long to answer."],
  ] as const)("says plainly when the model fails (%s)", async (reply, message) => {
    t = await createTestApp(ON, { fetch: fakeModel(reply).impl });
    if (reply === "hang") t.config.adviceModel!.timeoutMs = 20;
    const response = await ask(await signUp("ann"));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toEqual({ code: "unavailable", message });
  });

  it("allows thirty questions an hour for each user", async () => {
    t = await createTestApp(ON, { fetch: fakeModel("Fine.").impl });
    const ann = await signUp("ann");
    for (let n = 0; n < 30; n++) expect((await ask(ann)).status).toBe(200);
    const blocked = await ask(ann);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await ask(await signUp("bob"))).status).toBe(200);
    t.clock.advance(60 * 60 * 1000);
    expect((await ask(ann)).status).toBe(200);
  });

  it("keeps each user's figures and voice to themselves", async () => {
    const model = fakeModel("Fine.");
    t = await createTestApp(ON, { fetch: model.impl });
    const ann = await signUp("ann");
    const bob = await signUp("bob");
    await ann.post("/api/transactions", { name: "Ann's secret shop", amountCents: 5_000, kind: "expense", occursAt: "2026-01-14T10:00", paid: true });
    await ann.put("/api/advice/persona", { persona: "oscar" });

    expect((await (await bob.get("/api/advice")).json()).persona).toEqual({ persona: "plain", custom: null });
    await ask(bob);
    expect(model.user()).not.toContain("Ann's secret shop");
    expect(model.system()).not.toContain("Oscar");
    await ask(ann);
    expect(model.user()).toContain("Ann's secret shop");

    const signedOut = t.client();
    expect((await signedOut.get("/api/advice")).status).toBe(401);
    expect((await ask(signedOut)).status).toBe(401);
  });
});
