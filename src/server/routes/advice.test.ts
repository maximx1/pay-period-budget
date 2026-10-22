import { afterEach, describe, expect, it } from "vitest";
import { ADVICE_QUESTIONS } from "../../shared/advice.ts";
import { createTestApp, type TestApp } from "../testing.ts";

// The test clock starts at 2026-01-15T12:00Z. Biweekly from 2025-12-16, the current pay
// period is 2026-01-13..01-26.

type Call = { url: string; headers: Record<string, string>; body: { messages: Array<{ role: string; content: string }>; [key: string]: unknown } };

/** What a model's single choice says: its text (null for none) and why it stopped. */
type Choice = { content: string | null; finishReason: string };

/** A stand-in for an OpenAI-compatible server, answering with `content` (or a status, or never). */
function fakeModel(answer: string | number | "hang" | Choice) {
  const calls: Call[] = [];
  const impl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string>, body: JSON.parse(String(init?.body)) });
    if (answer === "hang") {
      return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("timeout"), { name: "TimeoutError" }))));
    }
    if (typeof answer === "number") return new Response("nope", { status: answer });
    const choice =
      typeof answer === "string"
        ? { message: { content: answer }, finish_reason: "stop" }
        : { message: { content: answer.content }, finish_reason: answer.finishReason };
    return new Response(JSON.stringify({ choices: [choice] }), { status: 200 });
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

const ask = (client: Client, questionId = "spending-pace", amountCents?: number) =>
  client.post("/api/advice", { questionId, ...(amountCents !== undefined && { amountCents }) });

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
      // The Quick Questions need no model.
      expect((await ann.get("/api/advice/quick")).status).toBe(200);
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
    expect(body.groups.map((group: { title: string }) => group.title)).toEqual(["This pay period", "Habits", "Bills and the months ahead", "Extra money"]);
    expect(body.groups.flatMap((group: { questions: unknown[] }) => group.questions)).toEqual(
      ADVICE_QUESTIONS.map(({ id, label, needsAmount }) => ({ id, label, ...(needsAmount && { needsAmount }) })),
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
      questionId: "spending-pace",
      answer: "Yes, with $812.40 to spare.\n- Rent lands on the 25th.",
      askedAt: "2026-01-15T12:00:00.000Z",
    });

    expect(model.calls).toHaveLength(1);
    const [call] = model.calls;
    expect(call!.url).toBe("http://models.local/v1/chat/completions");
    expect(call!.headers.Authorization).toBe("Bearer sk-advice");
    expect(call!.body).toMatchObject({ model: "adviser", max_tokens: 8000 });
    expect(model.system()).toContain("At most 80 words");
    expect(model.system()).not.toContain("voice");
    const user = model.user();
    expect(user).toMatch(/^Question: Am I spending faster than usual\?\nWhat to look at: /);
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
    // A model that thinks first and runs out of tokens doing it, as llama.cpp and Ollama report that.
    ...[null, "", "<think>So the leftover is"].map(
      (content) =>
        [
          { content, finishReason: "length" },
          "The adviser couldn't answer: it ran out of room before answering, probably thinking it over first.",
        ] as const,
    ),
  ] as const)("says plainly when the model fails (%j)", async (reply, message) => {
    t = await createTestApp(ON, { fetch: fakeModel(reply).impl });
    if (reply === "hang") t.config.adviceModel!.timeoutMs = 20;
    const response = await ask(await signUp("ann"));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toEqual({ code: "unavailable", message });
  });

  it("asks the model not to think first only when told to, and never shows its thinking", async () => {
    const model = fakeModel("<think>Leftover is positive, so yes.</think>Yes, with $40 to spare.");
    t = await createTestApp(ON, { fetch: model.impl });
    const ann = await signUp("ann");
    expect((await (await ask(ann)).json()).answer).toBe("Yes, with $40 to spare.");
    expect(model.calls.at(-1)!.body).not.toHaveProperty("chat_template_kwargs");
    t.cleanup();

    t = await createTestApp({ ...ON, ADVICE_MODEL_THINKING: "false" }, { fetch: model.impl });
    await ask(await signUp("ann"));
    expect(model.calls.at(-1)!.body.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("drops reasoning the model never finished when its answer was cut short", async () => {
    t = await createTestApp(ON, { fetch: fakeModel({ content: "Yes, just. <think>Should I mention", finishReason: "length" }).impl });
    expect((await (await ask(await signUp("ann"))).json()).answer).toBe("Yes, just.");
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

/** A loan and a savings account, each tracked. */
async function trackSome(client: Client) {
  const add = async (body: Record<string, unknown>) => (await (await client.post("/api/bills-income", body)).json()).item.id as string;
  const visa = await add({ name: "Visa", kind: "expense", defaultAmountCents: 10_000, recurrenceUnit: "month", firstDueDate: "2026-02-20" });
  const rainy = await add({ name: "Rainy day", kind: "transfer", defaultAmountCents: 0, recurrenceUnit: "none" });
  expect((await client.post(`/api/balances/${visa}`, { balanceCents: -250_000, aprBps: 2499 })).status).toBe(201);
  expect((await client.post(`/api/balances/${rainy}`, { balanceCents: 30_000 })).status).toBe(201);
  return { visa, rainy };
}

describe("quick questions", () => {
  it("are answered by the app itself, with what extra money plans need, with or without a model", async () => {
    t = await createTestApp({});
    const ann = await signUp("ann");
    await ann.post("/api/transactions", { name: "Kroger", amountCents: 12_345, kind: "expense", occursAt: "2026-01-14T10:00", paid: true });
    await ann.post("/api/bills-income", { name: "Rent", kind: "expense", defaultAmountCents: 90_000, recurrenceUnit: "month", firstDueDate: "2026-01-25" });
    const { visa, rainy } = await trackSome(ann);

    const response = await ann.get("/api/advice/quick");
    expect(response.status).toBe(200);
    const { answers, extra } = await response.json();
    const answer = (id: string) => answers.find((entry: { id: string }) => entry.id === id).answer as string;
    expect(answers.map((entry: { id: string }) => entry.id)).toEqual(["make-it-to-payday", "safe-daily-spend", "spoken-for", "tight-periods"]);
    // $1,000 opening, less Kroger and Rent.
    expect(answer("make-it-to-payday")).toBe(
      "No: you're set to end payday $23.45 below zero. Still to pay before then: $900.00 in 1 payment, the biggest Rent ($900.00).",
    );
    expect(answer("safe-daily-spend")).toBe(
      "Nothing beyond what's planned: the period is set to end $1,023.45 below where it started. There's nothing carried over to fall back on either.",
    );
    expect(answer("tight-periods")).toMatch(/^Tightest by scheduled bills against income: /);

    expect(extra).toMatchObject({
      periods: [{ startDate: "2026-01-13", endDate: "2026-01-26", projectedCents: -2_345 }],
      lowBalanceCents: 20_000,
      debts: [{ billIncomeId: visa, name: "Visa", owedCents: 250_000, aprBps: 2499, monthlyPaymentCents: 10_000 }],
      savings: [{ billIncomeId: rainy, name: "Rainy day", heldCents: 30_000, aprBps: null }],
    });
    // Every item's category, Rent's too, for filing a quick-added payment.
    expect(Object.keys(extra.categoryIds)).toHaveLength(3);
    expect(extra.categoryIds).toMatchObject({ [visa]: null, [rainy]: null });

    // Someone else's balances never appear.
    const bob = await signUp("bob");
    expect((await (await bob.get("/api/advice/quick")).json()).extra).toMatchObject({ debts: [], savings: [] });
    expect((await t.client().get("/api/advice/quick")).status).toBe(401);
  });
});

describe("questions about extra money", () => {
  it("need an amount, and give the model the debts, savings and the app's plans, numbered", async () => {
    const model = fakeModel("Clear the card first: it costs 24.99%.\nPLAN: [1] $100.00; [2] $50");
    t = await createTestApp(ON, { fetch: model.impl });
    const ann = await signUp("ann");
    const { visa, rainy } = await trackSome(ann);

    const missing = await ask(ann, "pay-down-debt");
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.fields).toEqual({ amountCents: "Enter an amount" });

    const response = await ask(ann, "pay-down-debt", 15_000);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      questionId: "pay-down-debt",
      answer: "Clear the card first: it costs 24.99%.",
      askedAt: "2026-01-15T12:00:00.000Z",
      plan: {
        items: [
          { billIncomeId: visa, name: "Visa", amountCents: 10_000 },
          { billIncomeId: rainy, name: "Rainy day", amountCents: 5_000 },
        ],
      },
    });
    const user = model.user();
    expect(user).toContain("For this question you may use up to 120 words.");
    expect(user).toContain('as "PLAN: [1] $250.00; [3] $100.00", adding up to no more than $150.00');
    expect(user).toContain("EXTRA MONEY: $150.00 to put somewhere now.");
    expect(user).toContain("- [1] Visa: owes $2,500.00; APR 24.99%; usual payment about $100.00 a month");
    expect(user).toContain("- [2] Rainy day: holds $300.00");
    expect(user).toMatch(/- Fastest: \[1\] Visa \$150\.00 \(24\.99% APR, the highest; paid off in about/);
  });

  it.each([
    ["names an item that isn't listed", "PLAN: [3] $10.00"],
    ["adds up to more than the amount", "PLAN: [1] $100.00; [2] $100.00"],
    ["says none", "PLAN: none"],
    ["has no plan line", "Pay the card."],
  ])("offers no plan when the answer %s, and never shows the line", async (_name, last) => {
    t = await createTestApp(ON, { fetch: fakeModel(`Pay the card.\n${last}`).impl });
    const ann = await signUp("ann");
    await trackSome(ann);
    const body = await (await ask(ann, "not-sure", 15_000)).json();
    expect(body.plan).toBeNull();
    expect(body.answer).toBe(last.startsWith("PLAN") ? "Pay the card." : `Pay the card.\n${last}`);
  });

  it("never plans more than keeps every pay period above zero", async () => {
    const model = fakeModel("Put it all on the card.\nPLAN: [1] $1,000.00");
    t = await createTestApp(ON, { fetch: model.impl });
    const ann = await signUp("ann");
    await trackSome(ann);
    // The opening $1,000 is all there is: asking about $5,000 plans $1,000.
    const body = await (await ask(ann, "pay-down-debt", 500_000)).json();
    expect(body.plan.items).toEqual([expect.objectContaining({ amountCents: 100_000 })]);
    expect(model.user()).toContain("- The plans use $1,000.00, not $5,000.00: more would take a pay period below zero.");
  });
});

describe("talking it through", () => {
  const talk = (client: Client, body: Record<string, unknown>) => client.post("/api/advice/talk", body);

  it("lets the adviser open, sends the facts once in the system message, and carries the conversation", async () => {
    const model = fakeModel("What would feel like a safe cushion to you?");
    t = await createTestApp(ON, { fetch: model.impl });
    const ann = await signUp("ann");
    await trackSome(ann);

    let response = await talk(ann, { messages: [] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "What would feel like a safe cushion to you?", plan: null });
    const opening = model.calls.at(-1)!.body.messages;
    expect(opening.map((message) => message.role)).toEqual(["system", "user"]);
    expect(opening[0]!.content).toContain("talking with the owner about getting out of debt and building savings");
    expect(opening[0]!.content).toContain("When a message suggests payments with amounts, end it with one line on its own");
    // With no amount given, the conversation is about the safe amount: $1,000 less the $200 warning.
    expect(opening[0]!.content).toContain("EXTRA MONEY: $800.00 to put somewhere now.");
    expect(opening[0]!.content).toContain("[1] Visa: owes $2,500.00");

    response = await talk(ann, {
      messages: [
        { role: "adviser", text: "What would feel like a safe cushion to you?" },
        { role: "owner", text: "About $500." },
      ],
      amountCents: 30_000,
    });
    expect(response.status).toBe(200);
    const next = model.calls.at(-1)!.body.messages;
    expect(next.map((message) => [message.role, message.role === "system" ? "" : message.content])).toEqual([
      ["system", ""],
      ["assistant", "What would feel like a safe cushion to you?"],
      ["user", "About $500."],
    ]);
    expect(next[0]!.content).toContain("EXTRA MONEY: $300.00 to put somewhere now.");
  });

  it("offers a quick add when a message names payments, and hides the numbers", async () => {
    t = await createTestApp(ON, { fetch: fakeModel("Then put $200 on [1] Visa and keep $100 back.\nPLAN: [1] $200.00").impl });
    const ann = await signUp("ann");
    const { visa } = await trackSome(ann);
    const body = await (await talk(ann, { messages: [{ role: "owner", text: "What now?" }], amountCents: 30_000 })).json();
    expect(body).toEqual({
      text: "Then put $200 on Visa and keep $100 back.",
      plan: { items: [{ billIncomeId: visa, name: "Visa", amountCents: 20_000 }] },
    });
  });

  it.each([
    ["the owner's turn", { messages: [{ role: "adviser", text: "Hello" }] }, "messages"],
    ["a message too long", { messages: [{ role: "owner", text: "x".repeat(1001) }] }, "messages.0.text"],
    ["an empty message", { messages: [{ role: "owner", text: "   " }] }, "messages.0.text"],
    [
      "a conversation too long",
      { messages: Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? "owner" : "adviser", text: "and?" })) },
      "messages",
    ],
  ])("refuses a request that isn't %s", async (_name, body, field) => {
    t = await createTestApp(ON, { fetch: fakeModel("Fine.").impl });
    const response = await talk(await signUp("ann"), body);
    expect(response.status).toBe(400);
    expect(Object.keys((await response.json()).error.fields)).toContain(field);
  });

  it("allows sixty messages an hour apart from the questions, needs a model, and keeps each owner's figures to themselves", async () => {
    const model = fakeModel("Go on.");
    t = await createTestApp(ON, { fetch: model.impl });
    const ann = await signUp("ann");
    const bob = await signUp("bob");
    await trackSome(ann);
    for (let n = 0; n < 60; n++) expect((await talk(ann, { messages: [] })).status).toBe(200);
    expect((await talk(ann, { messages: [] })).status).toBe(429);
    expect((await ask(ann)).status).toBe(200);

    await talk(bob, { messages: [] });
    expect(model.calls.at(-1)!.body.messages[0]!.content).not.toContain("Visa");
    expect((await t.client().post("/api/advice/talk", { messages: [] })).status).toBe(401);
    t.cleanup();

    t = await createTestApp({}, { fetch: model.impl });
    expect((await talk(await signUp("ann"), { messages: [] })).status).toBe(403);
  });
});
