import type { BillOrIncome } from "../../shared/billsIncome.ts";
import type { PeriodView } from "../../shared/budget.ts";
import { dateOf, diffDays, formatDateRange, type LocalDate } from "../../shared/dates.ts";
import { formatCents } from "../../shared/money.ts";
import type { Report, ReportPeriod } from "../../shared/reports.ts";
import type { ScheduleType } from "../../shared/schedule.ts";

// The figures a model is given to answer an Advice question from. Everything it might need
// to add up is added up here, so the model only has to read, compare and explain. Plain
// text, short lines, dollars rather than cents: what a model reads most reliably.

export type AdviceInputs = {
  scheduleType: ScheduleType;
  today: LocalDate;
  /** The pay period containing today. */
  current: PeriodView;
  /** Covers the past few pay periods through the current one. */
  report: Report;
  items: readonly BillOrIncome[];
};

const MAX_UPCOMING = 15;
const MAX_OVERDUE = 10;
const MAX_NAMES = 10;

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const mean = (values: readonly number[]) => (values.length === 0 ? 0 : Math.round(sum(values) / values.length));
const median = (values: readonly number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
};
const money = (cents: number) => formatCents(cents);
const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "n/a");
const SCHEDULE_WORDS: Record<ScheduleType, string> = { weekly: "every week", biweekly: "every two weeks", monthly: "every month" };
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function adviceFacts({ scheduleType, today, current, report, items }: AdviceInputs): string {
  const lines: string[] = [];
  const add = (...more: string[]) => lines.push(...more);
  const categoryName = new Map(report.categories.map((category) => [category.id, category.name]));
  const nameOfCategory = (id: string | null) => (id === null ? "Uncategorised" : (categoryName.get(id) ?? "Deleted"));
  const past = report.periods.filter((period) => !period.isCurrent && !period.isFuture);
  const now = report.periods.find((period) => period.isCurrent);

  add(`Today is ${today}. Paid ${SCHEDULE_WORDS[scheduleType]}. Amounts in US dollars.`, "");

  // ---- the current pay period
  const { period, totals } = current;
  const daysLeft = diffDays(today, period.endDate) + 1;
  const length = diffDays(period.startDate, period.endDate) + 1;
  const dayOf = length - daysLeft + 1;
  add(`CURRENT PAY PERIOD ${formatDateRange(period.startDate, period.endDate)}: day ${dayOf} of ${length}, ${daysLeft} days left including today.`);
  // What this period adds to or takes from the money carried into it. Spending more than that
  // eats into what earlier periods left, which is the owner's cushion.
  const gain = totals.projectedCents - period.startingCents;
  const perDay = (cents: number) => (cents > 0 ? money(Math.floor(cents / daysLeft)) : "nothing");
  add(
    `- Started with ${money(period.startingCents)}, carried over from earlier periods. Paid so far, net: ${money(totals.paidCents)}. Still upcoming, net: ${money(totals.upcomingCents)}.`,
    `- Projected leftover on payday: ${money(totals.projectedCents)}, which is ${money(Math.abs(gain))} ${gain >= 0 ? "more" : "less"} than the period started with.`,
    `- Safe to spend each day until payday, beyond what is planned, and still end no lower than the period started: ${perDay(gain)}.`,
    `- The same, using up everything carried over too: ${perDay(totals.projectedCents)}.`,
  );
  const pace = report.pace;
  if (pace.current && pace.current.length > 0) {
    const day = pace.current.length - 1;
    const usual = pace.usual?.[Math.min(day, pace.usual.length - 1)];
    add(
      `- Spent so far this period: ${money(pace.current[day]!)}${usual === undefined ? "" : `; usual by this day: ${money(usual)}`}.`,
    );
  }
  const upcoming = current.transactions.filter((tx) => tx.status === "upcoming" && dateOf(tx.occursAt) >= today);
  if (upcoming.length > 0) {
    add(`- Still to come before payday (${upcoming.length}):`);
    for (const tx of upcoming.slice(0, MAX_UPCOMING)) add(`  - ${dateOf(tx.occursAt)} ${tx.name}: ${money(tx.amountCents)}`);
    if (upcoming.length > MAX_UPCOMING) add(`  - and ${upcoming.length - MAX_UPCOMING} more`);
  }
  if (report.unpaid.length > 0) {
    add(`- Overdue: dated before today and still not marked paid (${report.unpaid.length}):`);
    for (const tx of report.unpaid.slice(-MAX_OVERDUE)) add(`  - ${dateOf(tx.occursAt)} ${tx.name}: ${money(tx.amountCents)}`);
  }
  if (current.categoryLimits.length > 0) {
    add("- Limits this period:");
    for (const limit of current.categoryLimits) {
      const over = limit.spentCents - limit.limitCents;
      add(`  - ${limit.name}: ${money(limit.spentCents)} of ${money(limit.limitCents)}${over > 0 ? `, over by ${money(over)}` : ""}`);
    }
  }
  add("");

  // ---- the pay periods before it
  if (past.length > 0) {
    add(`PAST PAY PERIODS, oldest first (${past.length}):`);
    for (const entry of past) {
      add(
        `- ${formatDateRange(entry.startDate, entry.endDate)}: income ${money(entry.incomeCents)}, spent ${money(entry.expenseCents)}, ` +
          `to transfers ${money(entry.transferOutCents)}, back from transfers ${money(entry.transferInCents)}, leftover at end ${money(entry.endingCents)}`,
      );
    }
    const usualIncome = median(past.map((entry) => entry.incomeCents));
    const committed = mean(past.map((entry) => entry.billOutCents));
    add(
      `- Usual income per pay period: ${money(usualIncome)}. Usual leftover at the end: ${money(median(past.map((entry) => entry.endingCents)))}.`,
      `- Bills and transfers take ${money(committed)} of a pay period on average, ${percent(committed, usualIncome)} of usual income.`,
    );
    if (pace.usual && pace.usual.length > 3) {
      // Without the even-spread share to compare with, a model read 22% of a 14-day period's
      // spending in three days as a splurge (2026-10-21).
      add(
        `- Usually ${percent(pace.usual[2]!, pace.usual.at(-1)!)} of a period's spending happens in its first three days; ` +
          `spread evenly it would be ${percent(3, pace.usual.length)}.`,
      );
    }
    add("");

    add("SPENDING BY CATEGORY, per pay period:");
    const categoryIds = new Set(report.periods.flatMap((entry) => entry.categories.map((flow) => flow.categoryId)));
    const outIn = (entry: ReportPeriod, id: string | null) => entry.categories.find((flow) => flow.categoryId === id)?.outCents ?? 0;
    const rows = [...categoryIds]
      .map((id) => ({ id, average: mean(past.map((entry) => outIn(entry, id))), thisPeriod: now ? outIn(now, id) : 0 }))
      .filter((row) => row.average > 0 || row.thisPeriod > 0)
      .sort((a, b) => b.average - a.average);
    for (const row of rows) {
      const limited = row.id === null ? [] : past.flatMap((entry) => entry.limits.filter((limit) => limit.categoryId === row.id));
      const overCount = limited.filter((limit) => limit.spentCents > limit.limitCents).length;
      const limitText = limited.length > 0 ? `; over its limit in ${overCount} of ${limited.length} past periods with one` : "";
      add(`- ${nameOfCategory(row.id)}: average ${money(row.average)}, this period so far ${money(row.thisPeriod)}${limitText}`);
    }
    add("");
  }

  if (report.names.length > 0) {
    add("NAMES MOST MONEY WENT TO, over these periods:");
    for (const entry of report.names.slice(0, MAX_NAMES)) add(`- ${entry.name}: ${money(entry.outCents)} in ${entry.count} payments`);
    add("");
  }
  if (report.largest.length > 0) {
    add("LARGEST ONE-OFF PAYMENTS (not added by a schedule):");
    for (const tx of report.largest) add(`- ${dateOf(tx.occursAt)} ${tx.name}: ${money(tx.amountCents)} (${nameOfCategory(tx.categoryId)})`);
    add("");
  }
  if (report.weekdays.some((cents) => cents > 0)) {
    add(`SPENDING BY WEEKDAY: ${report.weekdays.map((cents, i) => `${WEEKDAYS[i]} ${money(cents)}`).join(", ")}`, "");
  }

  // ---- bills and income
  const live = items.filter((item) => !item.archived);
  if (live.length > 0) {
    add("BILLS, INCOME AND TRANSFERS:");
    for (const item of live) {
      const yearly = report.billsIncome.find((entry) => entry.id === item.id)?.yearlyCents ?? null;
      const recent = past
        .map((entry) => entry.billsIncome.find((flow) => flow.billIncomeId === item.id))
        .map((flow) => (item.kind === "income" ? (flow?.inCents ?? 0) : (flow?.outCents ?? 0)))
        .filter((cents) => cents > 0);
      const kind = item.kind === "expense" ? "bill" : item.kind;
      const parts = [
        kind,
        item.scheduleText,
        item.defaultAmountCents > 0 ? `usual ${money(item.defaultAmountCents)}` : null,
        yearly ? `${money(yearly)} a year as scheduled` : null,
        item.categoryId ? `category ${nameOfCategory(item.categoryId)}` : null,
        recent.length > 0 ? `recent pay periods ${recent.map(money).join(", ")}` : null,
      ].filter(Boolean);
      add(`- ${item.name}: ${parts.join("; ")}`);
    }
    add("");
  }

  if (report.ahead.length > 0) {
    add("COMING PAY PERIODS, scheduled bills and income only:");
    for (const entry of report.ahead) {
      add(
        `- ${formatDateRange(entry.startDate, entry.endDate)}: bills ${money(entry.billsCents)}, income ${money(entry.incomeCents)}, ` +
          `left after bills ${money(entry.incomeCents - entry.billsCents)}`,
      );
    }
  }

  return lines.join("\n").trim();
}
