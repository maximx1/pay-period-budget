// How results are worded for the assistant reading them. Money is always shown both as
// dollars and as the integer cents the API uses, so nothing has to be converted by eye.
import type { PeriodView } from "../src/shared/budget.ts";
import { type Category, overLimitMessage, type PeriodCategoryLimit } from "../src/shared/categories.ts";
import { formatCents } from "../src/shared/money.ts";
import { type BillOrIncome, entryKindOf } from "../src/shared/billsIncome.ts";
import type { Report } from "../src/shared/reports.ts";
import type { Transaction } from "../src/shared/transactions.ts";

export const money = (cents: number) => `${formatCents(cents)} (${cents} cents)`;

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
export { plural };

/** One transaction on one line, ending with the id that update and delete need. */
export function transactionLine(transaction: Transaction): string {
  const origin = [
    transaction.billIncomeId &&
      `${transaction.occurrenceDate ? "generated from" : "tied to"} bill or income ${transaction.billIncomeId}`,
    transaction.importKey && `imported as "${transaction.importKey}"`,
    transaction.categoryId && `category ${transaction.categoryId}`,
  ].filter(Boolean);
  return [
    transaction.occursAt.replace("T", " "),
    money(transaction.amountCents),
    transaction.status,
    transaction.name,
    ...(transaction.note ? [`note: ${transaction.note}`] : []),
    ...origin,
    `id ${transaction.id}`,
  ].join(" | ");
}

export function transactionList(transactions: Transaction[]): string {
  if (transactions.length === 0) return "No transactions.";
  return transactions.map((transaction) => `- ${transactionLine(transaction)}`).join("\n");
}

export function categoryLine(category: Category): string {
  return [
    category.name,
    category.defaultLimitCents === null
      ? "no usual limit"
      : `usual limit ${money(category.defaultLimitCents)} each pay period`,
    `id ${category.id}`,
  ].join(" | ");
}

/** A period's limits, each with what has been spent against it, and a line for each one passed. */
export function limitLines(limits: PeriodCategoryLimit[]): string[] {
  if (limits.length === 0) return ["No category limits in this period."];
  return [
    `${plural(limits.length, "category limit")} (spent is money out less money in, paid and upcoming, filed under the category):`,
    ...limits.map(
      (limit) =>
        `- ${limit.name}: spent ${money(limit.spentCents)} of ${money(limit.limitCents)}, ` +
        `${money(limit.paidSpentCents)} of it paid | category ${limit.categoryId}`,
    ),
    ...limits.flatMap((limit) => {
      const message = overLimitMessage(limit);
      return message ? [`OVER: ${message}`] : [];
    }),
  ];
}

export function periodReport({ period, totals, transactions, categoryLimits }: PeriodView): string {
  const flags = [
    period.isCurrent && "the current period",
    period.seq < 0 && "before the budget began",
    period.datesEdited && "dates moved by hand",
  ].filter(Boolean);
  const starting = [
    period.startingMode === "manual" && "set by hand",
    period.carryStale && "may be out of date",
  ].filter(Boolean);

  return [
    `Period ${period.startDate} to ${period.endDate}${flags.length ? ` (${flags.join(", ")})` : ""} | id ${period.id}`,
    `Starting amount: ${money(period.startingCents)}${starting.length ? ` [${starting.join(", ")}]` : ""}`,
    `Paid: ${money(totals.paidCents)}`,
    `Upcoming: ${money(totals.upcomingCents)}`,
    `Leftover so far (starting + paid): ${money(totals.leftoverCents)}`,
    `Projected leftover (starting + paid + upcoming): ${money(totals.projectedCents)}`,
    "",
    ...limitLines(categoryLimits),
    "",
    `${plural(transactions.length, "transaction")}:`,
    transactionList(transactions),
  ].join("\n");
}

export function billOrIncomeLine(item: BillOrIncome): string {
  // A transfer's own entries are money out, like a bill's.
  const signedCents = entryKindOf(item.kind) === "expense" ? -item.defaultAmountCents : item.defaultAmountCents;
  return [
    item.name,
    item.kind,
    item.defaultAmountCents === 0 ? "no usual amount" : `${money(signedCents)} each time`,
    // The screen says "As it happens"; an assistant is told what the field holds.
    item.recurrenceUnit === "none" ? "No schedule" : item.scheduleText,
    ...(item.recurrenceUnit === "none" ? [] : [`first due ${item.firstDueDate}`]),
    ...(item.kind === "transfer" && item.openingCents !== 0 ? [`starting balance ${money(item.openingCents)}`] : []),
    ...(item.endDate ? [`ends ${item.endDate}`] : []),
    ...(item.categoryId ? [`category ${item.categoryId}`] : []),
    ...(item.archived ? ["archived"] : item.nextDueDate ? [`next due ${item.nextDueDate}`] : []),
    ...(item.description ? [`description: ${item.description}`] : []),
    `id ${item.id}`,
  ].join(" | ");
}

/** A report in words: each pay period on a line, then where the money went over the whole span. */
export function reportText(report: Report): string {
  const { periods } = report;
  if (periods.length === 0) return `No pay period falls between ${report.from} and ${report.to}.`;
  const total = (pick: (period: Report["periods"][number]) => number) => periods.reduce((sum, period) => sum + pick(period), 0);
  const income = total((period) => period.incomeCents);
  const expenses = total((period) => period.expenseCents);

  const categoryName = new Map(report.categories.map((category) => [category.id, category.name]));
  const itemName = new Map(report.billsIncome.map((item) => [item.id, item.name]));
  const outBy = <Key>(flows: (period: Report["periods"][number]) => Array<{ outCents: number }>, keyOf: (flow: never) => Key) => {
    const totals = new Map<Key, number>();
    for (const period of periods) {
      for (const flow of flows(period)) totals.set(keyOf(flow as never), (totals.get(keyOf(flow as never)) ?? 0) + flow.outCents);
    }
    return [...totals].filter(([, cents]) => cents > 0).sort((a, b) => b[1] - a[1]);
  };
  const byCategory = outBy((period) => period.categories, (flow: { categoryId: string | null }) => flow.categoryId);
  const byItem = outBy((period) => period.billsIncome, (flow: { billIncomeId: string | null }) => flow.billIncomeId);
  const over = periods.flatMap((period) =>
    period.limits
      .filter((limit) => limit.spentCents > limit.limitCents)
      .map(
        (limit) =>
          `- ${period.startDate} to ${period.endDate}: ${categoryName.get(limit.categoryId) ?? limit.categoryId} over by ` +
          `${money(limit.spentCents - limit.limitCents)} (spent ${money(limit.spentCents)} of ${money(limit.limitCents)})`,
      ),
  );

  return [
    `Report for ${plural(periods.length, "pay period")}, ${report.from} to ${report.to}. Whole pay periods, paid and upcoming together; today is ${report.today}.`,
    "Each transfer counts once a pay period, as what was sent to it less what came back; the transactions themselves are unchanged.",
    `Income ${money(income)}, expenses ${money(expenses)}, income less expenses ${money(income - expenses)}.`,
    "",
    "Each pay period (income | expenses | of which tied to a bill or transfer | leftover at its end):",
    ...periods.map(
      (period) =>
        `- ${period.startDate} to ${period.endDate}${period.isCurrent ? " (current)" : period.isFuture ? " (upcoming)" : ""}: ` +
        `${money(period.incomeCents)} | ${money(period.expenseCents)} | ${money(period.billOutCents)} | ${money(period.endingCents)}`,
    ),
    "",
    "Money out by category:",
    ...(byCategory.length === 0
      ? ["- none"]
      : byCategory.map(([id, cents]) => `- ${id === null ? "Uncategorised" : (categoryName.get(id) ?? id)}: ${money(cents)}`)),
    "",
    "Money out by bill or transfer:",
    ...(byItem.length === 0
      ? ["- none"]
      : byItem.map(([id, cents]) => `- ${id === null ? "Not tied to a bill" : (itemName.get(id) ?? id)}: ${money(cents)}`)),
    "",
    over.length === 0 ? "No category limit was passed in this span." : "Category limits passed:",
    ...over,
    "",
    "Names most was spent under:",
    ...(report.names.length === 0
      ? ["- none"]
      : report.names.map((entry) => `- ${entry.name}: ${money(entry.outCents)} in ${plural(entry.count, "transaction")}`)),
    "",
    report.unpaid.length === 0
      ? "Nothing dated before today is still marked upcoming."
      : `${plural(report.unpaid.length, "transaction")} dated before today ${report.unpaid.length === 1 ? "is" : "are"} still marked upcoming:`,
    ...report.unpaid.map((transaction) => `- ${transactionLine(transaction)}`),
  ].join("\n");
}
