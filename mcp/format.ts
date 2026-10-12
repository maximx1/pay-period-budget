// How results are worded for the assistant reading them. Money is always shown both as
// dollars and as the integer cents the API uses, so nothing has to be converted by eye.
import type { PeriodView } from "../src/shared/budget.ts";
import { formatCents } from "../src/shared/money.ts";
import type { RecurringItem } from "../src/shared/recurring.ts";
import type { Transaction } from "../src/shared/transactions.ts";

export const money = (cents: number) => `${formatCents(cents)} (${cents} cents)`;

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
export { plural };

/** One transaction on one line, ending with the id that update and delete need. */
export function transactionLine(transaction: Transaction): string {
  const origin = [
    transaction.recurringId &&
      `${transaction.occurrenceDate ? "generated from" : "tied to"} recurring item ${transaction.recurringId}`,
    transaction.importKey && `imported as "${transaction.importKey}"`,
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

export function periodReport({ period, totals, transactions }: PeriodView): string {
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
    `${plural(transactions.length, "transaction")}:`,
    transactionList(transactions),
  ].join("\n");
}

export function recurringLine(item: RecurringItem): string {
  const signedCents = item.kind === "expense" ? -item.defaultAmountCents : item.defaultAmountCents;
  return [
    item.name,
    `${money(signedCents)} each time`,
    item.scheduleText,
    `first due ${item.firstDueDate}`,
    ...(item.endDate ? [`ends ${item.endDate}`] : []),
    ...(item.archived ? ["archived"] : item.nextDueDate ? [`next due ${item.nextDueDate}`] : []),
    ...(item.description ? [`description: ${item.description}`] : []),
    `id ${item.id}`,
  ].join(" | ");
}
