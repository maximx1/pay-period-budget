// Creates a second local development account, "demo", holding about nine months of
// made-up budget: bills, categories with limits, a few hundred transactions. It is there to
// look at reports and search with something in them. Never run against a real deployment.
//
//   npm run db:seed-demo              create it (does nothing if it exists)
//   npm run db:seed-demo -- --remove  delete it and everything it holds
import { createClient } from "@libsql/client";
import { addDays, todayIn } from "../../shared/dates.ts";
import { createApp } from "../app.ts";
import { openDatabase } from "../db/client.ts";
import { loadConfig } from "../env.ts";
import { createSqliteStore } from "../repos/sqlite/index.ts";
import { createTestClient } from "../testing.ts";

const DEMO_USER = { username: "demo", email: "demo@example.com", password: "demo-budget-1" };
const TIMEZONE = "America/New_York";
const PERIODS_BACK = 18;

try {
  process.loadEnvFile();
} catch {
  // No .env file.
}

const config = loadConfig();
if (config.isProduction) {
  console.error("Refusing to seed a production database.");
  process.exit(1);
}

if (process.argv.includes("--remove")) {
  const client = createClient({ url: config.databaseUrl });
  await client.execute("PRAGMA foreign_keys = ON");
  const { rowsAffected } = await client.execute({ sql: "delete from users where email = ?", args: [DEMO_USER.email] });
  client.close();
  console.log(rowsAffected > 0 ? `Removed ${DEMO_USER.email} and everything it held.` : `${DEMO_USER.email} does not exist.`);
  process.exit(0);
}

const { db, close } = await openDatabase(config.databaseUrl);
const store = createSqliteStore(db);
if (await store.users.findByEmail(DEMO_USER.email)) {
  console.log(`${DEMO_USER.email} already exists; nothing to do. Remove it with: npm run db:seed-demo -- --remove`);
  close();
  process.exit(0);
}

// Everything goes through the real API, in this process, so the demo data obeys every rule
// real data does.
const { app } = createApp({ store, config: { ...config, allowRegistration: true } });
const api = createTestClient(app);

async function send<T>(method: "post" | "patch" | "put", path: string, body: unknown): Promise<T> {
  const response = await api[method](path, body);
  if (!response.ok) throw new Error(`${method.toUpperCase()} ${path} answered ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

// The same "random" numbers every run, so the demo always looks the same.
let seed = 20261013;
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const between = (low: number, high: number) => Math.round(low + random() * (high - low));
const pick = <T>(choices: readonly T[]): T => choices[Math.floor(random() * choices.length)]!;

await send("post", "/api/auth/register", DEMO_USER);
const today = todayIn(TIMEZONE, new Date());
const anchorDate = addDays(today, -(PERIODS_BACK * 14 + 5));
await send("post", "/api/budget", { type: "biweekly", anchorDate, openingCents: 185_000, timezone: TIMEZONE });

const categoryId: Record<string, string> = {};
for (const [name, defaultLimitCents] of [
  ["Groceries", 32_000],
  ["Eating out", 12_000],
  ["Fuel", 10_000],
  ["Fun", 8_000],
  ["Housing", null],
  ["Utilities", null],
  ["Household", null],
  ["Health", null],
  ["Clothes", null],
  ["Gifts", null],
] as const) {
  const { category } = await send<{ category: { id: string } }>("post", "/api/categories", { name, defaultLimitCents, applyToPeriods: true });
  categoryId[name] = category.id;
}

const itemId: Record<string, string> = {};
const day = (offset: number) => addDays(anchorDate, offset);
for (const item of [
  { name: "Paycheck", kind: "income", defaultAmountCents: 215_000, recurrenceUnit: "period", firstDueDate: anchorDate },
  { name: "Rent", kind: "expense", defaultAmountCents: 112_000, recurrenceUnit: "month", firstDueDate: day(9), categoryId: categoryId.Housing },
  { name: "Car payment", kind: "expense", defaultAmountCents: 28_900, recurrenceUnit: "month", firstDueDate: day(3) },
  { name: "Car insurance", kind: "expense", defaultAmountCents: 11_800, recurrenceUnit: "month", firstDueDate: day(17) },
  { name: "Electric", kind: "expense", defaultAmountCents: 9_400, recurrenceUnit: "month", firstDueDate: day(12), categoryId: categoryId.Utilities },
  { name: "Internet", kind: "expense", defaultAmountCents: 6_000, recurrenceUnit: "month", firstDueDate: day(20), categoryId: categoryId.Utilities },
  { name: "Phone", kind: "expense", defaultAmountCents: 4_500, recurrenceUnit: "month", firstDueDate: day(6), categoryId: categoryId.Utilities },
  { name: "Streaming", kind: "expense", defaultAmountCents: 1_599, recurrenceUnit: "month", firstDueDate: day(1), categoryId: categoryId.Fun },
  { name: "Gym", kind: "expense", defaultAmountCents: 3_000, recurrenceUnit: "month", firstDueDate: day(15), categoryId: categoryId.Health },
  { name: "Savings", kind: "transfer", defaultAmountCents: 15_000, recurrenceUnit: "period", firstDueDate: anchorDate, openingCents: 240_000 },
  { name: "Side jobs", kind: "income", defaultAmountCents: 0, recurrenceUnit: "none" },
]) {
  const created = await send<{ item: { id: string } }>("post", "/api/bills-income", item);
  itemId[item.name] = created.item.id;
}

type PeriodSummary = { id: string; startDate: string; endDate: string };
const { periods } = (await (await api.get("/api/periods")).json()) as { periods: PeriodSummary[] };

// Limits go to the current period by themselves; the ones before it are given theirs here.
for (const period of periods) {
  if (period.endDate >= today) continue;
  for (const [name, limitCents] of [["Groceries", 32_000], ["Eating out", 12_000], ["Fuel", 10_000], ["Fun", 8_000]] as const) {
    await send("put", `/api/periods/${period.id}/limits/${categoryId[name]}`, { limitCents });
  }
}

// Everyday spending: how often in a pay period, between what amounts, and under which names.
const habits = [
  { category: "Groceries", times: [3, 5], cents: [3_800, 11_500], names: ["Kroger", "Aldi", "Costco", "KROGER #512"] },
  { category: "Eating out", times: [2, 6], cents: [900, 4_600], names: ["Chipotle", "Pizza place", "Coffee shop", "Taco truck", "Diner"] },
  { category: "Fuel", times: [1, 3], cents: [3_200, 5_800], names: ["Shell", "Speedway"] },
  { category: "Fun", times: [0, 3], cents: [1_200, 6_500], names: ["Cinema", "Bowling", "Bookshop", "Concert tickets"] },
  { category: "Household", times: [0, 3], cents: [1_500, 9_000], names: ["Target", "Home Depot", "Amazon"] },
  { category: "Health", times: [0, 1], cents: [1_500, 8_000], names: ["Pharmacy", "Dentist copay"] },
  { category: "Clothes", times: [0, 1], cents: [2_500, 12_000], names: ["Old Navy", "Shoe shop"] },
  { category: "Gifts", times: [0, 1], cents: [2_000, 7_500], names: ["Birthday present", "Flowers"] },
  { category: null, times: [1, 3], cents: [500, 4_000], names: ["ATM withdrawal", "Parking", "Venmo", "Car wash"] },
] as const;

const rows: unknown[] = [];
periods.forEach((period, index) => {
  const length = 14;
  for (const habit of habits) {
    for (let n = between(habit.times[0], habit.times[1]); n > 0; n--) {
      const date = addDays(period.startDate, between(0, length - 1));
      if (date > period.endDate) continue;
      rows.push({
        name: pick(habit.names),
        amountCents: between(habit.cents[0], habit.cents[1]),
        kind: "expense",
        occursAt: `${date}T${String(between(8, 20)).padStart(2, "0")}:${pick(["05", "20", "35", "50"])}`,
        // What is still to come in the current period is a plan, not a payment.
        paid: date <= today,
        categoryId: habit.category === null ? null : categoryId[habit.category],
      });
    }
  }
  if (index % 5 === 2) {
    rows.push({ name: "Roofing with Sam", amountCents: between(18_000, 42_000), kind: "income", occursAt: `${addDays(period.startDate, 6)}T00:00`, paid: true, billIncomeId: itemId["Side jobs"] });
  }
  if (index === 11) {
    rows.push({ name: "From savings", amountCents: 60_000, kind: "income", occursAt: `${addDays(period.startDate, 4)}T00:00`, paid: true, billIncomeId: itemId.Savings });
    rows.push({ name: "Car repair", amountCents: 58_700, kind: "expense", occursAt: `${addDays(period.startDate, 4)}T10:20`, paid: true });
  }
});
await send("post", "/api/transactions/import", { transactions: rows.filter((row) => (row as { occursAt: string }).occursAt.slice(0, 10) <= periods.at(-1)!.endDate) });

// What the schedules added: paid once its date has passed, with the bills that vary varying.
type Entry = { id: string; name: string; status: string; occursAt: string; billIncomeId: string | null; occurrenceDate: string | null };
const { transactions } = (await (await api.get(`/api/transactions?from=${anchorDate}&to=${addDays(anchorDate, 365)}`)).json()) as { transactions: Entry[] };
const internetRise = day(PERIODS_BACK * 7);
let skipped = 0;
for (const entry of transactions) {
  if (entry.occurrenceDate === null) continue;
  const date = entry.occursAt.slice(0, 10);
  const patch: Record<string, unknown> = {};
  if (entry.name === "Electric") patch.amountCents = between(7_200, 13_800);
  if (entry.name === "Internet" && date >= internetRise) patch.amountCents = 7_000;
  // Two bills from a while back were never ticked, to have something under "Not yet marked paid".
  const forgotten = entry.name === "Gym" && date < today && skipped < 2 && random() < 0.3;
  if (forgotten) skipped += 1;
  else if (date <= today) patch.status = "paid";
  if (Object.keys(patch).length > 0) await send("patch", `/api/transactions/${entry.id}`, patch);
}

close();
console.log(`Created the demo account: ${rows.length} transactions over ${periods.length} pay periods.`);
console.log(`Sign in as "${DEMO_USER.username}"; the password is DEMO_USER.password in src/server/scripts/seedDemo.ts.`);
