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

// Parts (phase 32): a balance made of several, a student loan's sub-loans each with its own
// balance and rate under one payment. See "Balances in parts" in docs/plan/domain.md.

export const MAX_PARTS = 20;
const partNameSchema = z.string("Give it a name").trim().min(1, "Give it a name").max(60, "Keep it to 60 characters");

const partInputSchema = z.object({
  /** One of the balance's parts, from an earlier check. Left out: a new part. */
  id: z.string().min(1).optional(),
  name: partNameSchema,
  /** Signed: below zero is owed. */
  balanceCents: balanceCentsSchema,
  /** Null: no rate. Left out: the part's last rate (none for a new one). */
  aprBps: aprBpsSchema.nullable().optional(),
});
export type BalancePartInput = z.output<typeof partInputSchema>;

const checkFields = {
  /** Signed: below zero is owed. Left out with parts: they are added up. */
  balanceCents: balanceCentsSchema.optional(),
  /** Null: no rate. Left out: the last check's rate carries on. Never with parts. */
  aprBps: aprBpsSchema.nullable().optional(),
  /** Every part, with its balance. Empty, with a balance: no longer in parts. */
  parts: z.array(partInputSchema).max(MAX_PARTS, `At most ${MAX_PARTS} parts`).optional(),
  /** When the balance was this, in the budget's time zone. Left out: now. Never ahead of now. */
  asOf: z.string().refine(isLocalDateTime, "Enter a valid date and time").optional(),
};

/** A check is a balance or its parts, never both; parts are named apart and all on one side of zero. */
function checkRules(input: { balanceCents?: number; aprBps?: number | null; parts?: BalancePartInput[] }, ctx: z.RefinementCtx) {
  const parts = input.parts ?? [];
  if (parts.length === 0) {
    if (input.balanceCents === undefined) ctx.addIssue({ code: "custom", path: ["balanceCents"], message: "Enter an amount" });
    return;
  }
  if (input.balanceCents !== undefined) {
    ctx.addIssue({ code: "custom", path: ["balanceCents"], message: "Leave the total out: it is the parts added up" });
  }
  if (input.aprBps !== undefined) ctx.addIssue({ code: "custom", path: ["aprBps"], message: "Give each part its own rate" });
  const seen = new Set<string>();
  parts.forEach((part, index) => {
    const key = part.name.toLowerCase();
    if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["parts", index, "name"], message: "Another part has this name" });
    seen.add(key);
  });
  if (parts.some((part) => part.balanceCents < 0) && parts.some((part) => part.balanceCents > 0)) {
    ctx.addIssue({ code: "custom", path: ["parts"], message: "Every part is owed, or every part is in it" });
  }
  if (Math.abs(parts.reduce((sum, part) => sum + part.balanceCents, 0)) > MAX_OPENING_CENTS) {
    ctx.addIssue({ code: "custom", path: ["parts"], message: "That amount is too large" });
  }
}

export const balanceCheckInputSchema = z.object(checkFields).superRefine(checkRules);
export type BalanceCheckInput = z.output<typeof balanceCheckInputSchema>;

export const trackBalanceInputSchema = z
  .object({
    ...checkFields,
    /** Null or left out: the account's setting. */
    checkEveryDays: checkEveryDaysSchema.nullable().optional(),
  })
  .superRefine(checkRules);
export type TrackBalanceInput = z.output<typeof trackBalanceInputSchema>;

export const trackedBalancePatchSchema = z.object({
  /** Null: the account's setting. Left out: unchanged. */
  checkEveryDays: checkEveryDaysSchema.nullable().optional(),
  /** The last check's rate, changed in place; null for none. Left out: unchanged. Not for a balance in parts. */
  aprBps: aprBpsSchema.nullable().optional(),
});
export type TrackedBalancePatch = z.output<typeof trackedBalancePatchSchema>;

/** One part of the last check, changed in place. */
export const balancePartPatchSchema = z.object({
  name: partNameSchema.optional(),
  /** Null for none. */
  aprBps: aprBpsSchema.nullable().optional(),
});
export type BalancePartPatch = z.output<typeof balancePartPatchSchema>;

/**
 * Shares out what a balance has moved since its check over its parts, in proportion to
 * their balances then (by size), so the shares add up to `movedCents` exactly: whole cents
 * by the largest remainder, ties to the earlier part. All at zero: evenly.
 */
export function shareOverParts(balancesCents: readonly number[], movedCents: number): number[] {
  if (balancesCents.length === 0) return [];
  const sizes = balancesCents.map((cents) => BigInt(Math.abs(cents)));
  const weights = sizes.some((size) => size > 0n) ? sizes : sizes.map(() => 1n);
  const whole = weights.reduce((sum, weight) => sum + weight, 0n);
  const moved = BigInt(Math.abs(movedCents));
  const shares = weights.map((weight) => (moved * weight) / whole);
  const remainders = weights.map((weight, index) => ({ index, rest: (moved * weight) % whole }));
  let left = Number(moved - shares.reduce((sum, share) => sum + share, 0n));
  remainders.sort((a, b) => (a.rest === b.rest ? a.index - b.index : a.rest > b.rest ? -1 : 1));
  for (const { index } of remainders) {
    if (left <= 0) break;
    shares[index]! += 1n;
    left -= 1;
  }
  const sign = movedCents < 0 ? -1 : 1;
  return shares.map((share) => sign * Number(share));
}

/** The parts' rate as one: weighted by balance among those with a rate. Null when none has one. */
export function blendedAprBps(parts: ReadonlyArray<{ balanceCents: number; aprBps: number | null }>): number | null {
  const rated = parts.filter((part): part is { balanceCents: number; aprBps: number } => part.aprBps !== null);
  if (rated.length === 0) return null;
  const weight = rated.reduce((sum, part) => sum + Math.abs(part.balanceCents), 0);
  if (weight === 0) return Math.round(rated.reduce((sum, part) => sum + part.aprBps, 0) / rated.length);
  return Math.round(rated.reduce((sum, part) => sum + Math.abs(part.balanceCents) * part.aprBps, 0) / weight);
}

/** About a month's interest over the parts, each at its own rate; null when none has a rate. */
export function partsInterestCents(parts: ReadonlyArray<{ estimateCents: number; aprBps: number | null }>): number | null {
  const charges = parts.map((part) => monthlyInterestCents(part.estimateCents, part.aprBps)).filter((cents) => cents !== null);
  return charges.length === 0 ? null : charges.reduce((sum, cents) => sum + cents, 0);
}

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

export type BalanceCheckPart = {
  /** The part's own id, the same in every check it is in. */
  id: string;
  name: string;
  /** Signed: below zero is owed. */
  balanceCents: number;
  aprBps: number | null;
};

export type BalanceCheck = {
  id: string;
  /** Signed: below zero is owed. With parts, them added up. */
  balanceCents: number;
  /** With parts, their balance-weighted rate. */
  aprBps: number | null;
  asOf: LocalDateTime;
  /** Empty for a balance not in parts. */
  parts: BalanceCheckPart[];
};

/** A part of a tracked balance now: its last check plus its share of what has moved the whole since. */
export type TrackedBalancePart = {
  id: string;
  name: string;
  estimateCents: number;
  aprBps: number | null;
  monthlyInterestCents: number | null;
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
  /** About a month's interest at the last check's APR, positive; null without one. With parts, theirs added up. */
  monthlyInterestCents: number | null;
  /** The last check's parts, as estimated now; empty for a balance not in parts. Their estimates add up to the whole's. */
  parts: TrackedBalancePart[];
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
