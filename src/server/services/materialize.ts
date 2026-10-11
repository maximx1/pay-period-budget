import { randomUUID } from "node:crypto";
import { atStartOfDay } from "../../shared/dates.ts";
import { occurrencesBetween, type Recurrence } from "../../shared/recurrence.ts";
import type { PeriodRecord, RecurringRecord, Repos } from "../repos/types.ts";

export const ruleOf = (item: RecurringRecord): Recurrence => ({
  unit: item.recurrenceUnit,
  interval: item.recurrenceInterval,
  firstDueDate: item.firstDueDate,
  endDate: item.endDate,
});

/**
 * Turns a recurring item's occurrences within one period into upcoming transactions.
 * Safe to repeat: an occurrence that already has a transaction is skipped. Returns how
 * many were added and their signed total, which is how much the period's projected
 * leftover changed. With `dryRun` nothing is written and every occurrence is counted.
 */
export async function materializeInPeriod(
  repos: Repos,
  item: RecurringRecord,
  period: PeriodRecord,
  now: Date,
  options: { dryRun?: boolean } = {},
): Promise<{ count: number; sumCents: number; dates: string[] }> {
  const amountCents = item.kind === "expense" ? -item.defaultAmountCents : item.defaultAmountCents;
  const added: string[] = [];

  for (const date of occurrencesBetween(ruleOf(item), period.startDate, period.endDate, period.startDate)) {
    const inserted =
      options.dryRun ||
      (await repos.transactions.createIfAbsent({
        id: randomUUID(),
        userId: item.userId,
        name: item.name,
        amountCents,
        occursAt: atStartOfDay(date),
        status: "upcoming",
        paidAt: null,
        sortOrder: 0,
        note: null,
        recurringId: item.id,
        occurrenceDate: date,
        createdAt: now,
        updatedAt: now,
      }));
    if (inserted) added.push(date);
  }
  return { count: added.length, sumCents: added.length * amountCents, dates: added };
}

/** Every recurring item of the period's owner, for a period that has just been generated. */
export async function materializeAllInPeriod(repos: Repos, period: PeriodRecord, now: Date): Promise<void> {
  for (const item of await repos.recurring.list(period.userId)) {
    await materializeInPeriod(repos, item, period, now);
  }
}
