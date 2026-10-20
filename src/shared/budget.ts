import { z } from "zod";
import type { PeriodCategoryLimit } from "./categories.ts";
import { isLocalDate, type LocalDate } from "./dates.ts";
import type { DueNotice } from "./dueDates.ts";
import { SCHEDULE_TYPES, type ScheduleType } from "./schedule.ts";
import type { Transaction } from "./transactions.ts";

/** How far back the first period may start, in days. */
export const MAX_ANCHOR_AGE_DAYS = 366;

const MAX_OPENING_CENTS = 10_000_000_000; // $100 million either way

export const localDateSchema = z.string().refine(isLocalDate, "Enter a valid date");

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const timezoneSchema = z.string().min(1).max(64).refine(isTimeZone, "Unknown time zone");

export const settingsPatchSchema = z.object({ timezone: timezoneSchema });

export const budgetSetupSchema = z.object({
  type: z.enum(SCHEDULE_TYPES, "Choose how often you are paid"),
  /** First day of the first period; usually the most recent payday. */
  anchorDate: localDateSchema,
  openingCents: z
    .number()
    .int("Enter a whole number of cents")
    .min(-MAX_OPENING_CENTS, "That amount is too large")
    .max(MAX_OPENING_CENTS, "That amount is too large")
    .default(0),
  timezone: timezoneSchema,
});
export type BudgetSetupInput = z.output<typeof budgetSetupSchema>;

export const locateSchema = z.object({ date: localDateSchema });

export type Budget = {
  type: ScheduleType;
  anchorDate: LocalDate;
  openingCents: number;
  timezone: string;
};

export type BudgetResponse = { budget: Budget | null };

export type PeriodView = {
  period: {
    id: string;
    seq: number;
    startDate: LocalDate;
    /** Inclusive. */
    endDate: LocalDate;
    nominalStart: LocalDate;
    nominalEnd: LocalDate;
    /** True when the dates were moved off the schedule by hand. */
    datesEdited: boolean;
    /** True when the period contains today in the budget's time zone. */
    isCurrent: boolean;
    startingCents: number;
    startingMode: "auto" | "manual";
    carryStale: boolean;
  };
  totals: {
    paidCents: number;
    upcomingCents: number;
    /** Leftover so far: starting amount + paid. */
    leftoverCents: number;
    /** Projected leftover: starting amount + paid + upcoming. This is what carries forward. */
    projectedCents: number;
  };
  /** In display order: by date-time, then manual order, then creation. */
  transactions: Transaction[];
  /** This period's limits, by category name, with what has been spent against each. */
  categoryLimits: PeriodCategoryLimit[];
  /** Days in this period a bill or transfer is due with nothing set to pay it by then, by date. */
  dueNotices: DueNotice[];
  nav: {
    prevId: string | null;
    /** With no previous period: whether one may be added before this one (as far back as MAX_HISTORY_YEARS). */
    canAddPrevious: boolean;
    /** Set when the next period already exists. */
    nextId: string | null;
    /** When there is no next period yet: the date to `locate` to create it, or null at the horizon. */
    nextDate: LocalDate | null;
  };
};

export type LocateResponse = { periodId: string };

/** Just enough of a period to find it by date. */
export type PeriodSummary = {
  id: string;
  startDate: LocalDate;
  /** Inclusive. */
  endDate: LocalDate;
};

/** Every period that exists, oldest first. */
export type PeriodListResponse = { periods: PeriodSummary[] };

const MAX_STARTING_CENTS = MAX_OPENING_CENTS;

export const startingAmountSchema = z.object({
  startingCents: z
    .number("Enter an amount")
    .int("Enter a whole number of cents")
    .min(-MAX_STARTING_CENTS, "That amount is too large")
    .max(MAX_STARTING_CENTS, "That amount is too large"),
  /** Apply the difference to later periods too, or leave them as they are and flag them. */
  carryForward: z.boolean(),
});

export const periodDatesSchema = z
  .object({
    startDate: localDateSchema.optional(),
    endDate: localDateSchema.optional(),
    /** Report what would happen without changing anything. */
    preview: z.boolean().optional(),
  })
  .refine((input) => input.startDate !== undefined || input.endDate !== undefined, "Nothing to change");
export type PeriodDatesInput = z.output<typeof periodDatesSchema>;

/** One period whose dates a change touches: the one being edited or a neighbour sharing a boundary. */
export type PeriodDateChange = {
  role: "previous" | "this" | "next";
  startDate: LocalDate;
  endDate: LocalDate;
  previousStartDate: LocalDate;
  previousEndDate: LocalDate;
};

export type PeriodDatesResponse = {
  view: PeriodView;
  changes: PeriodDateChange[];
  /** Transactions that fall in a different period as a result. */
  movedTransactions: number;
};
