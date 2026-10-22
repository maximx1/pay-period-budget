import { QUICK_QUESTIONS, type QuickAnswer } from "../../shared/advice.ts";
import { dateOf, diffDays, formatDateRange } from "../../shared/dates.ts";
import { formatCents } from "../../shared/money.ts";
import type { OutlookPeriod } from "../../shared/outlook.ts";
import type { AdviceInputs } from "./adviceFacts.ts";

// Quick Questions (phase 29): answered by the app itself, from the same figures a model
// would be given, in a line or two. Nothing here guesses: where there is nothing to go by,
// the answer says so.

const money = formatCents;
const MOST_NAMED = 3;

const median = (values: readonly number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
};
const list = (items: readonly string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

export type QuickInputs = AdviceInputs & {
  /** The coming periods that exist, as the low balance warnings look at them. */
  coming: readonly OutlookPeriod[];
  lowBalanceCents: number;
};

function makeItToPayday({ current, today, report }: QuickInputs): string {
  const { period, totals } = current;
  const gain = totals.projectedCents - period.startingCents;
  const lines = [
    totals.projectedCents < 0
      ? `No: you're set to end payday ${money(-totals.projectedCents)} below zero.`
      : gain >= 0
        ? `Yes: you're set to end payday with ${money(totals.projectedCents)}, ${money(gain)} more than this period started with.`
        : `Yes, but it's tight: you're set to end payday with ${money(totals.projectedCents)}, ${money(-gain)} less than this period started with.`,
  ];
  const coming = current.transactions.filter((tx) => tx.status === "upcoming" && dateOf(tx.occursAt) >= today && tx.amountCents < 0);
  if (coming.length > 0) {
    const total = coming.reduce((sum, tx) => sum + tx.amountCents, 0);
    const biggest = [...coming].sort((a, b) => a.amountCents - b.amountCents).slice(0, MOST_NAMED);
    lines.push(
      `Still to pay before then: ${money(-total)} in ${coming.length === 1 ? "1 payment" : `${coming.length} payments`}, the biggest ` +
        `${list(biggest.map((tx) => `${tx.name} (${money(-tx.amountCents)})`))}.`,
    );
  }
  if (report.unpaid.length > 0) {
    lines.push(
      `${report.unpaid.length === 1 ? "1 payment is" : `${report.unpaid.length} payments are`} dated before today and not marked paid yet: ` +
        "if they've gone through, mark them paid.",
    );
  }
  return lines.join(" ");
}

function safeDailySpend({ current, today }: QuickInputs): string {
  const { period, totals } = current;
  const daysLeft = diffDays(today, period.endDate) + 1;
  const days = daysLeft === 1 ? "today" : `each of the ${daysLeft} days left, today included`;
  const gain = totals.projectedCents - period.startingCents;
  const outer =
    totals.projectedCents > 0
      ? `Using what was carried over from earlier periods too, the most is ${money(Math.floor(totals.projectedCents / daysLeft))} a day.`
      : "There's nothing carried over to fall back on either.";
  return gain > 0
    ? `${money(Math.floor(gain / daysLeft))} ${daysLeft === 1 ? "today" : `a day, ${days}`}, beyond what's planned, and you still end no lower than the period started. ${outer}`
    : `Nothing beyond what's planned: the period is set to end ${money(-gain)} below where it started. ${outer}`;
}

function spokenFor({ report }: QuickInputs): string {
  const past = report.periods.filter((period) => !period.isCurrent && !period.isFuture);
  if (past.length === 0) return "There's no finished pay period to go by yet.";
  const income = median(past.map((period) => period.incomeCents));
  const committed = Math.round(past.reduce((sum, period) => sum + period.billOutCents, 0) / past.length);
  if (income <= 0) return `Bills and transfers take ${money(committed)} a pay period on average, and there's no usual income to set that against.`;
  return (
    `Bills and transfers take ${money(committed)} of a usual ${money(income)} paycheck: ${Math.round((committed / income) * 100)}%. ` +
    `That leaves ${money(income - committed)} for everything else, over the last ${past.length === 1 ? "pay period" : `${past.length} pay periods`}.`
  );
}

function tightPeriods({ report, coming, lowBalanceCents }: QuickInputs): string {
  const lines: string[] = [];
  const ahead = [...report.ahead].sort((a, b) => a.incomeCents - a.billsCents - (b.incomeCents - b.billsCents));
  if (ahead.length > 0) {
    const tightest = ahead.slice(0, MOST_NAMED).map(
      (entry) => `${formatDateRange(entry.startDate, entry.endDate)} (${money(entry.incomeCents - entry.billsCents)} left after ${money(entry.billsCents)} of bills)`,
    );
    lines.push(`Tightest by scheduled bills against income: ${list(tightest)}.`);
  }
  const low = coming.filter((period) => period.level !== "ok");
  if (coming.length > 0) {
    lines.push(
      low.length === 0
        ? `None of the next ${coming.length === 1 ? "pay period" : `${coming.length} pay periods`} is set to end below ${money(lowBalanceCents)}.`
        : `Set to end low: ${list(low.map((period) => `${formatDateRange(period.startDate, period.endDate)} at ${money(period.projectedCents)}`))}.`,
    );
  }
  return lines.length > 0 ? lines.join(" ") : "There are no coming pay periods with anything scheduled to go by.";
}

const ANSWERS: Record<(typeof QUICK_QUESTIONS)[number]["id"], (inputs: QuickInputs) => string> = {
  "make-it-to-payday": makeItToPayday,
  "safe-daily-spend": safeDailySpend,
  "spoken-for": spokenFor,
  "tight-periods": tightPeriods,
};

export function quickAnswers(inputs: QuickInputs): QuickAnswer[] {
  return QUICK_QUESTIONS.map(({ id, label }) => ({ id, label, answer: ANSWERS[id](inputs) }));
}
