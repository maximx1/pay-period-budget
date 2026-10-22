import { formatApr } from "./balances.ts";
import { formatCents } from "./money.ts";

// Where extra money should go (phase 29): plans worked out the same way on the Advice page
// (instantly, as the amount changes) and on the server (as facts for a model). Pure.

/** A tracked balance below zero, as money owed. */
export type Debt = {
  billIncomeId: string;
  name: string;
  /** Positive. */
  owedCents: number;
  aprBps: number | null;
  /** Its scheduled payment as a monthly amount; null when it has no schedule. */
  monthlyPaymentCents: number | null;
};

/** A tracked balance at or above zero. */
export type Saving = {
  billIncomeId: string;
  name: string;
  heldCents: number;
  aprBps: number | null;
};

export const PLAN_STRATEGIES = ["balanced", "fastest", "fewest", "savings"] as const;
export type PlanStrategy = (typeof PLAN_STRATEGIES)[number];

export const STRATEGY_LABELS: Record<PlanStrategy, string> = {
  balanced: "Balanced",
  fastest: "Fastest",
  fewest: "Fewest payments",
  savings: "Savings",
};

/** What paying something extra now does to a debt's payoff, at its usual payment. Null months: never, at that payment. */
export type Payoff = {
  monthsBefore: number | null;
  monthsAfter: number | null;
  /** Interest no longer paid. Null when it has no APR, or one side never ends. */
  interestSavedCents: number | null;
};

export type PlanLine = {
  billIncomeId: string;
  name: string;
  kind: "debt" | "savings";
  amountCents: number;
  /** Why it gets this: "24.99% APR, the highest". */
  reason: string;
  /** For a debt with a usual payment. */
  payoff: Payoff | null;
};

export type Plan = {
  strategy: PlanStrategy;
  amountCents: number;
  lines: PlanLine[];
  /** What nothing could take: every debt cleared and no savings to put it in. */
  unplacedCents: number;
};

/** High interest goes before savings in the balanced plan. */
export const HIGH_APR_BPS = 800;
/** Fifty years: past this a payoff is "never" for all practical purposes. */
const MAX_MONTHS = 600;

/**
 * How much can go somewhere now. Paying it lowers today's period's end and every later one
 * by the same amount (the leftover carries), so the lowest of their projected ends is what
 * limits it: `safeCents` keeps every one at or above the warning amount, `zeroCents` at or
 * above zero. `limiting` is the index of the period that sets the limit.
 */
export function safeToSpare(
  periods: ReadonlyArray<{ projectedCents: number }>,
  lowBalanceCents: number,
): { safeCents: number; zeroCents: number; limiting: number } {
  if (periods.length === 0) return { safeCents: 0, zeroCents: 0, limiting: -1 };
  let limiting = 0;
  periods.forEach((period, index) => {
    if (period.projectedCents < periods[limiting]!.projectedCents) limiting = index;
  });
  const lowest = periods[limiting]!.projectedCents;
  return { safeCents: Math.max(0, lowest - lowBalanceCents), zeroCents: Math.max(0, lowest), limiting };
}

/** Months to pay off `owedCents` at `aprBps` paying `monthlyPaymentCents`, and the interest on the way. */
export function payoffMonths(
  owedCents: number,
  aprBps: number | null,
  monthlyPaymentCents: number,
): { months: number | null; interestCents: number | null } {
  if (owedCents <= 0) return { months: 0, interestCents: 0 };
  if (monthlyPaymentCents <= 0) return { months: null, interestCents: null };
  let balance = owedCents;
  let interest = 0;
  for (let month = 1; month <= MAX_MONTHS; month++) {
    const charged = aprBps === null ? 0 : Math.round((balance * aprBps) / 10_000 / 12);
    // A payment that doesn't cover the interest never gets anywhere.
    if (charged >= monthlyPaymentCents) return { months: null, interestCents: null };
    interest += charged;
    balance += charged - monthlyPaymentCents;
    if (balance <= 0) return { months: month, interestCents: aprBps === null ? null : interest };
  }
  return { months: null, interestCents: null };
}

function payoffOf(debt: Debt, extraCents: number): Payoff | null {
  if (debt.monthlyPaymentCents === null) return null;
  const before = payoffMonths(debt.owedCents, debt.aprBps, debt.monthlyPaymentCents);
  const after = payoffMonths(debt.owedCents - extraCents, debt.aprBps, debt.monthlyPaymentCents);
  return {
    monthsBefore: before.months,
    monthsAfter: after.months,
    interestSavedCents:
      before.interestCents !== null && after.interestCents !== null ? before.interestCents - after.interestCents : null,
  };
}

/** Highest rate first; a debt with no rate last; smaller first between equals. */
const byRate = (a: Debt, b: Debt) => (b.aprBps ?? -1) - (a.aprBps ?? -1) || a.owedCents - b.owedCents;
/** Smallest balance first. */
const byBalance = (a: Debt, b: Debt) => a.owedCents - b.owedCents || byRate(a, b);

type Allocation = Map<string, { cents: number; reasons: string[] }>;

/** Pours `cents` into the debts in order, each up to what it owes (less what it already got). */
function pourIntoDebts(cents: number, debts: readonly Debt[], into: Allocation, reasonOf: (debt: Debt, index: number) => string): number {
  let left = cents;
  debts.forEach((debt, index) => {
    if (left <= 0) return;
    const already = into.get(debt.billIncomeId)?.cents ?? 0;
    const take = Math.min(left, debt.owedCents - already);
    if (take <= 0) return;
    const entry = into.get(debt.billIncomeId) ?? { cents: 0, reasons: [] };
    entry.cents += take;
    entry.reasons.push(reasonOf(debt, index));
    into.set(debt.billIncomeId, entry);
    left -= take;
  });
  return left;
}

/**
 * Splits `cents` over the savings, lowest first: it brings the lowest up to the next, then
 * both up to the one after, and so on; past the highest it is shared evenly.
 */
export function splitOverSavings(cents: number, savings: readonly Saving[]): Map<string, number> {
  const shares = new Map<string, number>();
  if (cents <= 0 || savings.length === 0) return shares;
  const sorted = [...savings].sort((a, b) => a.heldCents - b.heldCents);
  const level = sorted.map((saving) => saving.heldCents);
  let left = cents;
  // How many of the lowest are being raised together; they are always level with each other.
  let count = 1;
  while (left > 0) {
    while (count < sorted.length && sorted[count]!.heldCents <= level[0]!) count += 1;
    const next = count < sorted.length ? sorted[count]!.heldCents : Number.POSITIVE_INFINITY;
    const step = Math.min(next - level[0]!, Math.floor(left / count));
    if (step <= 0) break;
    for (let i = 0; i < count; i++) level[i]! += step;
    left -= step * count;
  }
  // Cents too few to raise everyone by one each go to the lowest first.
  for (let i = 0; left > 0; i = (i + 1) % count, left--) level[i]! += 1;
  sorted.forEach((saving, i) => {
    const share = level[i]! - saving.heldCents;
    if (share > 0) shares.set(saving.billIncomeId, share);
  });
  return shares;
}

/**
 * One way to put `amountCents` somewhere. Debts are tracked balances below zero; savings
 * those at or above. `monthlySpendCents` is about a month of usual spending, the cushion the
 * balanced plan builds savings toward first.
 */
export function makePlan(
  strategy: PlanStrategy,
  amountCents: number,
  debts: readonly Debt[],
  savings: readonly Saving[],
  monthlySpendCents: number,
): Plan {
  const toDebts: Allocation = new Map();
  const toSavings: Allocation = new Map();
  const saveInto = (cents: number, reason: string) => {
    for (const [id, share] of splitOverSavings(cents, savings)) {
      const entry = toSavings.get(id) ?? { cents: 0, reasons: [] };
      entry.cents += share;
      if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
      toSavings.set(id, entry);
    }
    return savings.length > 0 ? 0 : cents;
  };
  const rateReason = (debt: Debt, index: number) =>
    debt.aprBps === null ? "no APR given, so after those with one" : `${formatApr(debt.aprBps)} APR${index === 0 ? ", the highest" : ""}`;

  let left = Math.max(0, amountCents);
  const byRateDebts = [...debts].sort(byRate);

  if (strategy === "fastest") {
    left = pourIntoDebts(left, byRateDebts, toDebts, rateReason);
  } else if (strategy === "fewest") {
    left = pourIntoDebts(left, [...debts].sort(byBalance), toDebts, (debt, index) =>
      index === 0 ? `${formatCents(debt.owedCents)} left, the smallest` : `${formatCents(debt.owedCents)} left, the next smallest`,
    );
  } else if (strategy === "savings") {
    left = saveInto(left, "toward your savings, lowest first");
  } else {
    // 1. A cushion: savings up to about a month of usual spending.
    const held = savings.reduce((sum, saving) => sum + saving.heldCents, 0);
    const short = savings.length > 0 ? Math.max(0, monthlySpendCents - held) : 0;
    const cushion = Math.min(left, short);
    if (cushion > 0) left -= cushion - saveInto(cushion, `a cushion of about a month's spending (${formatCents(monthlySpendCents)})`);
    // 2. High interest.
    const costly = byRateDebts.filter((debt) => (debt.aprBps ?? 0) >= HIGH_APR_BPS);
    left = pourIntoDebts(left, costly, toDebts, (debt) => `${formatApr(debt.aprBps!)} APR: high interest goes first`);
    // 3. Half and half: savings, and the highest-rate debt still owing.
    const owing = byRateDebts.filter((debt) => (toDebts.get(debt.billIncomeId)?.cents ?? 0) < debt.owedCents);
    const half = savings.length > 0 && owing.length > 0 ? Math.floor(left / 2) : savings.length > 0 ? left : 0;
    if (half > 0) left -= half - saveInto(half, "half of what was left, to savings");
    left = pourIntoDebts(left, owing, toDebts, () => "the rest, to the highest rate still owing");
    // What the debts didn't need.
    if (left > 0) left = saveInto(left, "what the debts didn't need, to savings");
  }

  const lines: PlanLine[] = [];
  for (const debt of debts) {
    const entry = toDebts.get(debt.billIncomeId);
    if (!entry) continue;
    const clears = entry.cents === debt.owedCents;
    lines.push({
      billIncomeId: debt.billIncomeId,
      name: debt.name,
      kind: "debt",
      amountCents: entry.cents,
      reason: entry.reasons.join("; ") + (clears ? `; clears it${debt.monthlyPaymentCents ? ` and its ${formatCents(debt.monthlyPaymentCents)} a month` : ""}` : ""),
      payoff: payoffOf(debt, entry.cents),
    });
  }
  for (const saving of savings) {
    const entry = toSavings.get(saving.billIncomeId);
    if (entry) {
      lines.push({ billIncomeId: saving.billIncomeId, name: saving.name, kind: "savings", amountCents: entry.cents, reason: entry.reasons.join("; "), payoff: null });
    }
  }
  lines.sort((a, b) => b.amountCents - a.amountCents);
  return { strategy, amountCents: Math.max(0, amountCents), lines, unplacedCents: left };
}

/** "in about 2 years 3 months", "in about 7 months", "never at this payment". */
export function describeMonths(months: number | null): string {
  if (months === null) return "never at this payment";
  if (months === 0) return "now";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [years > 0 ? `${years} ${years === 1 ? "year" : "years"}` : "", rest > 0 ? `${rest} ${rest === 1 ? "month" : "months"}` : ""];
  return `in about ${parts.filter(Boolean).join(" ")}`;
}
