import { canHaveDueDate } from "../../shared/billsIncome.ts";
import { addDays, dateOf, type LocalDate } from "../../shared/dates.ts";
import { type DueNotice, type DuePayment, type DueRule, dueChecksBetween, dueNoticeFor } from "../../shared/dueDates.ts";
import type { BillOrIncomeRecord, PeriodRecord, Repos } from "../repos/types.ts";

// The days in a period a bill or transfer is normally due with nothing set to pay it by
// then. See "Due dates" in docs/plan/domain.md.

/** When the item is normally due, or null if it has no due date. */
export const dueRuleOf = (item: BillOrIncomeRecord): DueRule | null =>
  item.dueDate === null
    ? null
    : { unit: item.dueUnit, interval: item.dueInterval, date: item.dueDate, endDate: item.endDate };

/**
 * Every day in the period one of the user's bills or transfers is due that no payment
 * toward it covers, or that is soon with nothing toward it marked paid, by date and then
 * name. A payment is a transaction tied to the item, paid or upcoming, money out; it may sit
 * in another period.
 */
export async function dueNoticesIn(repos: Repos, period: PeriodRecord, today: LocalDate): Promise<DueNotice[]> {
  const checks = (await repos.billsIncome.list(period.userId)).flatMap((item) => {
    const rule = dueRuleOf(item);
    if (!rule || !canHaveDueDate(item.kind)) return [];
    return dueChecksBetween(rule, period.startDate, period.endDate).map((check) => ({ item, check }));
  });
  if (checks.length === 0) return [];

  // One read covers every cycle: from the day after the earliest previous due date to the
  // day before the latest next one.
  const previous = checks.map(({ check }) => check.previous).sort();
  const next = checks.map(({ check }) => check.next).sort();
  const from = addDays(previous[0] ?? period.startDate, 1);
  const to = addDays(next.at(-1) ?? period.endDate, -1);
  const ids = [...new Set(checks.map(({ item }) => item.id))];
  const payments = new Map<string, DuePayment[]>();
  for (const record of await repos.transactions.listForBillsIncomeInRange(period.userId, ids, from, to)) {
    // Money brought back from a transfer, or a refund on a bill, pays nothing.
    if (record.billIncomeId === null || record.amountCents >= 0) continue;
    const payment = { date: dateOf(record.occursAt), late: record.latePayment, paid: record.status === "paid" };
    payments.set(record.billIncomeId, [...(payments.get(record.billIncomeId) ?? []), payment]);
  }

  return checks
    .flatMap(({ item, check }) => {
      const notice = dueNoticeFor(check, payments.get(item.id) ?? [], today);
      return notice ? [{ billIncomeId: item.id, name: item.name, ...notice }] : [];
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name));
}
