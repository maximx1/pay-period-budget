import { z } from "zod";
import { MAX_OPENING_CENTS, type BillOrIncomeKind } from "./billsIncome.ts";
import { addDays, isLocalDateTime, type LocalDate, type LocalDateTime } from "./dates.ts";

// Balances (phase 28): what a bill or transfer's own account owes or holds, checked by hand
// now and then and estimated in between. See "Balances" in docs/plan/domain.md.

/** How often to ask for a check, in days, as Settings and an item offer it. Each is "about". */
export const CHECK_EVERY_OPTIONS = [
  { days: 14, label: "About every 2 weeks" },
  { days: 30, label: "About every month" },
  { days: 61, label: "About every 2 months" },
  { days: 91, label: "About every 3 months" },
] as const;
export type CheckEveryDays = (typeof CHECK_EVERY_OPTIONS)[number]["days"];
const CHECK_EVERY_DAYS = CHECK_EVERY_OPTIONS.map((option) => option.days) as [CheckEveryDays, ...CheckEveryDays[]];

export const DEFAULT_CHECK_EVERY_DAYS: CheckEveryDays = 30;
export const DEFAULT_CHECKS_PER_DAY = 3;
export const MAX_CHECKS_PER_DAY = 5;
/** How far a next check may land either side of the interval: a quarter of it. */
const JITTER = 0.25;
/** 999.99%. Payday loans run to hundreds of percent; anything above is a typing slip. */
export const MAX_APR_BPS = 99_999;
export const SNOOZE_DAYS = [1, 3, 7] as const;

/** A bill or a transfer can track a balance; an income cannot. */
export const canTrackBalance = (kind: BillOrIncomeKind): boolean => kind !== "income";
export const TRACK_ONLY_MONEY_OUT_MESSAGE = "Only a bill or a transfer can track a balance";

/**
 * When to ask next: about `everyDays` after `from`, give or take a quarter of it, so items
 * checked on the same day drift apart. `random` is in [0, 1).
 */
export function nextCheckOn(from: LocalDate, everyDays: number, random: number): LocalDate {
  const spread = everyDays * (1 - JITTER + 2 * JITTER * random);
  return addDays(from, Math.max(1, Math.round(spread)));
}

/**
 * Which due items to ask about today, oldest due first: as many as the day's limit leaves
 * once those already checked or snoozed today are counted.
 */
export function asksFor(
  items: ReadonlyArray<{ billIncomeId: string; name: string; nextCheckOn: LocalDate }>,
  today: LocalDate,
  perDay: number,
  handledToday: number,
): string[] {
  const room = Math.max(0, perDay - handledToday);
  return items
    .filter((item) => item.nextCheckOn <= today)
    .sort((a, b) => (a.nextCheckOn < b.nextCheckOn ? -1 : a.nextCheckOn > b.nextCheckOn ? 1 : a.name.localeCompare(b.name)))
    .slice(0, room)
    .map((item) => item.billIncomeId);
}

/** About a month's interest on a balance at this APR, as a positive amount: owed on a debt, earned on savings. */
export function monthlyInterestCents(balanceCents: number, aprBps: number | null): number | null {
  if (aprBps === null) return null;
  return Math.round((Math.abs(balanceCents) * aprBps) / 10_000 / 12);
}

/** "24.99%", "5%". */
export function formatApr(aprBps: number): string {
  return `${(aprBps / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}

/** "24.99" or "24.99%" to basis points; null when it isn't a rate. Empty is not a rate either. */
export function parseAprInput(text: string): number | null {
  const match = /^\s*(\d{1,3})(?:\.(\d{0,2}))?\s*%?\s*$/.exec(text);
  if (!match) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return bps <= MAX_APR_BPS ? bps : null;
}

/** "Owed" below zero, "In it" otherwise. */
export const balanceSide = (balanceCents: number): "owed" | "held" => (balanceCents < 0 ? "owed" : "held");

const balanceCentsSchema = z
  .number("Enter an amount")
  .int("Enter a whole number of cents")
  .min(-MAX_OPENING_CENTS, "That amount is too large")
  .max(MAX_OPENING_CENTS, "That amount is too large");
const aprBpsSchema = z
  .number("Enter a rate")
  .int("Enter a rate to two decimal places")
  .min(0, "Enter zero or more")
  .max(MAX_APR_BPS, "That rate is too high");
const checkEveryDaysSchema = z
  .number("Choose how often")
  .refine((days): days is CheckEveryDays => (CHECK_EVERY_DAYS as readonly number[]).includes(days), "Choose how often");

export const balanceCheckInputSchema = z.object({
  /** Signed: below zero is owed. */
  balanceCents: balanceCentsSchema,
  /** Null: no rate. Left out: the last check's rate carries on. */
  aprBps: aprBpsSchema.nullable().optional(),
  /** When the balance was this, in the budget's time zone. Left out: now. Never ahead of now. */
  asOf: z.string().refine(isLocalDateTime, "Enter a valid date and time").optional(),
});
export type BalanceCheckInput = z.output<typeof balanceCheckInputSchema>;

export const trackBalanceInputSchema = balanceCheckInputSchema.extend({
  /** Null or left out: the account's setting. */
  checkEveryDays: checkEveryDaysSchema.nullable().optional(),
});
export type TrackBalanceInput = z.output<typeof trackBalanceInputSchema>;

export const trackedBalancePatchSchema = z.object({
  /** Null: the account's setting. Left out: unchanged. */
  checkEveryDays: checkEveryDaysSchema.nullable().optional(),
  /** The last check's rate, changed in place; null for none. Left out: unchanged. */
  aprBps: aprBpsSchema.nullable().optional(),
});
export type TrackedBalancePatch = z.output<typeof trackedBalancePatchSchema>;

export const snoozeInputSchema = z.object({
  days: z.number().refine((days) => (SNOOZE_DAYS as readonly number[]).includes(days), "Choose how long"),
});

export const balanceSettingsSchema = z.object({
  checkEveryDays: checkEveryDaysSchema,
  checksPerDay: z
    .number("Choose how many")
    .int("Choose how many")
    .min(1, "At least one a day")
    .max(MAX_CHECKS_PER_DAY, `At most ${MAX_CHECKS_PER_DAY} a day`),
});
export type BalanceSettings = z.output<typeof balanceSettingsSchema>;

export type BalanceCheck = {
  id: string;
  /** Signed: below zero is owed. */
  balanceCents: number;
  aprBps: number | null;
  asOf: LocalDateTime;
};

export type TrackedBalance = {
  billIncomeId: string;
  name: string;
  kind: BillOrIncomeKind;
  /** The last check, plus every paid transaction tied to the item dated after it. */
  estimateCents: number;
  lastCheck: BalanceCheck;
  /** How many paid transactions since the last check the estimate counts. */
  sinceCount: number;
  /** About a month's interest at the last check's APR, positive; null without one. */
  monthlyInterestCents: number | null;
  /** The item's own interval; null follows the account's setting. */
  checkEveryDays: CheckEveryDays | null;
  nextCheckOn: LocalDate;
  /** Due for a check: its next date has come. */
  due: boolean;
  /** Its bill or transfer has ended. */
  archived: boolean;
};

export type BalancesResponse = {
  /** By name. */
  balances: TrackedBalance[];
  totals: {
    /** Every balance below zero, as a positive amount. */
    owedCents: number;
    /** Every balance at or above zero. */
    heldCents: number;
  };
  /** The items to ask about on the home screen today, in order. */
  asks: string[];
  settings: BalanceSettings;
};

export type BalanceHistoryResponse = {
  balance: TrackedBalance;
  /** Newest first. */
  checks: BalanceCheck[];
  /** The paid transactions since the last check that make up the difference, oldest first. */
  since: Array<{ id: string; name: string; amountCents: number; occursAt: LocalDateTime }>;
};

export type TrackedBalanceResponse = { balance: TrackedBalance };
