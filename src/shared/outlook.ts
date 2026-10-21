import { z } from "zod";
import { formatDateRange, type LocalDate } from "./dates.ts";
import { formatCents } from "./money.ts";

// Warnings about the pay periods coming up: one set to end low, or below zero. See "Low
// balance warnings" in docs/plan/domain.md.

/** How many periods after the current one may be looked at. 0 turns the warnings off. */
export const MAX_PERIODS_AHEAD = 10;
export const DEFAULT_PERIODS_AHEAD = 5;
/** A period set to end below this is "running low". */
export const DEFAULT_LOW_BALANCE_CENTS = 20_000; // $200.00
const MAX_LOW_BALANCE_CENTS = 100_000_000; // $1,000,000.00

/** Per account. */
export type LowBalanceSettings = {
  /** Warn when a period is set to end below this. 0 warns only below zero. */
  lowBalanceCents: number;
  /** How many periods after the current one to look at; 0 is off. */
  periodsAhead: number;
};

export const lowBalanceSettingsSchema = z.object({
  lowBalanceCents: z
    .number("Enter an amount")
    .int("Enter a whole number of cents")
    .min(0, "Enter zero or more")
    .max(MAX_LOW_BALANCE_CENTS, "That amount is too large"),
  periodsAhead: z
    .number("Choose how many pay periods")
    .int("Choose how many pay periods")
    .min(0, "Choose how many pay periods")
    .max(MAX_PERIODS_AHEAD, `At most ${MAX_PERIODS_AHEAD} pay periods`),
});

export type LowBalanceSettingsResponse = { settings: LowBalanceSettings };

/** "negative" is the urgent one: set to end below zero. */
export type BalanceLevel = "ok" | "low" | "negative";

export function balanceLevel(projectedCents: number, lowBalanceCents: number): BalanceLevel {
  if (projectedCents < 0) return "negative";
  return projectedCents < lowBalanceCents ? "low" : "ok";
}

export type OutlookPeriod = {
  periodId: string;
  startDate: LocalDate;
  /** Inclusive. */
  endDate: LocalDate;
  /** What it is set to end with: its projected leftover. */
  projectedCents: number;
  level: BalanceLevel;
};

/**
 * `GET /api/periods/outlook`: the periods after the current one, as many as the settings
 * say, of those that exist. One not generated yet is left out, not worked out.
 */
export type BalanceOutlook = {
  settings: LowBalanceSettings;
  /** Oldest first. Empty when the warnings are off. */
  periods: OutlookPeriod[];
};

/** The periods to warn about at one level, oldest first. */
export const periodsAt = (outlook: BalanceOutlook, level: Exclude<BalanceLevel, "ok">) =>
  outlook.periods.filter((period) => period.level === level);

/** The heading of the warning for one level, or null when no period is at it. */
export function outlookHeading(outlook: BalanceOutlook, level: Exclude<BalanceLevel, "ok">): string | null {
  const count = periodsAt(outlook, level).length;
  if (count === 0) return null;
  const which = count === 1 ? "A coming pay period is" : `${count} coming pay periods are`;
  return level === "negative"
    ? `${which} set to end below zero.`
    : `${which} set to end below ${formatCents(outlook.settings.lowBalanceCents)}.`;
}

/** One period in a warning: "Dec 4 – Dec 17, 2026: ends with $142.10". */
export const outlookLine = ({ startDate, endDate, projectedCents }: OutlookPeriod) =>
  `${formatDateRange(startDate, endDate)}: ends with ${formatCents(projectedCents)}`;
