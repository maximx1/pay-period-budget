import { z } from "zod";
import type { BillOrIncomeKind } from "./billsIncome.ts";
import { localDateSchema } from "./budget.ts";
import type { LocalDate } from "./dates.ts";
import type { Transaction } from "./transactions.ts";

/**
 * A report covers whole pay periods: every period that shares at least one day with
 * `from`..`to`. Money is added up over everything dated in them, paid or upcoming, except
 * that each transfer's money sent and brought back within one period counts once, as the
 * difference, under the transfer's own category (see `netTransfers`). Limits are the
 * exception to that: they count each transaction under its own category, as the home
 * screen does.
 */
export const reportQuerySchema = z
  .object({ from: localDateSchema, to: localDateSchema })
  .refine(({ from, to }) => to >= from, { path: ["to"], message: "The end date is before the start date" });
export type ReportQuery = z.output<typeof reportQuerySchema>;

/** Money out and money in, each as a positive amount. */
export type ReportFlow = { outCents: number; inCents: number };

export type ReportPeriod = {
  id: string;
  startDate: LocalDate;
  /** Inclusive. */
  endDate: LocalDate;
  /** It contains today. */
  isCurrent: boolean;
  /** It starts after today: everything in it is still to come. */
  isFuture: boolean;
  startingCents: number;
  /** The projected leftover: starting amount plus everything in the period. */
  endingCents: number;
  incomeCents: number;
  expenseCents: number;
  /** The part of `expenseCents` tied to a bill, an income or a transfer: what was committed. */
  billOutCents: number;
  /**
   * Money sent to transfers (the owner's other accounts), and brought back from them, each
   * transfer netted within the period: $300 sent and $100 back is $200 sent and nothing back.
   */
  transferOutCents: number;
  transferInCents: number;
  /** How many transactions. */
  count: number;
  /** By category; `categoryId` null is everything filed under none. Only where there was any money. */
  categories: Array<ReportFlow & { categoryId: string | null }>;
  /** By bill or income; `billIncomeId` null is everything tied to none. */
  billsIncome: Array<ReportFlow & { billIncomeId: string | null }>;
  /** The period's limits, with what was spent against each (see "Limits" in domain.md). */
  limits: Array<{ categoryId: string; limitCents: number; spentCents: number }>;
};

export type Report = {
  /** What it covers: the first period's start through the last one's end. As asked when no period matched. */
  from: LocalDate;
  to: LocalDate;
  /** Today in the budget's time zone. */
  today: LocalDate;
  /** Oldest first. */
  periods: ReportPeriod[];
  categories: Array<{ id: string; name: string }>;
  billsIncome: Array<{
    id: string;
    name: string;
    kind: BillOrIncomeKind;
    /** What its schedule comes to over the next twelve months at its usual amount. Null with no schedule. */
    yearlyCents: number | null;
  }>;
  /** The names most was spent under, compared without regard to case. At most 15, largest first. */
  names: Array<{ name: string; outCents: number; count: number }>;
  /** The ten largest payments that no schedule added, largest first. */
  largest: Transaction[];
  /** Money out by day of the week, Monday first. */
  weekdays: number[];
  /**
   * Money out added up day by day through a period. `current` is the period containing
   * today, up to today, when the report covers it; `usual` is the average of the periods
   * before it. Null where there is nothing to show.
   */
  pace: { current: number[] | null; usual: number[] | null };
  /** Still marked upcoming though dated before today. Oldest first, at most 50. */
  unpaid: Transaction[];
  /**
   * What the schedules of bills and income add to each of the six pay periods after the
   * current one, at their usual amounts. Whatever the report covers.
   */
  ahead: Array<{ startDate: LocalDate; endDate: LocalDate; billsCents: number; incomeCents: number }>;
};
