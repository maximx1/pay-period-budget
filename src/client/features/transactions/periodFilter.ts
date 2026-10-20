import { centsToInput } from "../../../shared/money.ts";
import { searchKey, type Transaction } from "../../../shared/transactions.ts";

/** Stands for "filed under no category" among the categories chosen. */
export const NO_CATEGORY = "none";

/** What narrows one period's Upcoming and Paid lists. Nothing chosen shows everything. */
export type PeriodFilter = {
  /** Looked for in the name, the note, the category's name and the amount. */
  text: string;
  /** Category ids, and NO_CATEGORY. Empty: any category. */
  categoryIds: ReadonlySet<string>;
};

export const NO_FILTER: PeriodFilter = { text: "", categoryIds: new Set() };

export const isFiltering = (filter: PeriodFilter): boolean =>
  filter.text.trim() !== "" || filter.categoryIds.size > 0;

const MONEY = /^\d+(\.\d{0,2})?$/;

/**
 * Whether typed text reads as this amount, either way the money went. Whole dollars match
 * those dollars and any cents ("45" is $45.00 and $45.99, not $145); with a point, the
 * cents typed so far must agree ("45.5" is $45.50 to $45.59). "$" and "," are ignored.
 */
function matchesAmount(text: string, amountCents: number): boolean {
  const typed = text.replaceAll("$", "").replaceAll(",", "").replace(/^[+-]/, "");
  if (!MONEY.test(typed)) return false;
  const amount = centsToInput(amountCents);
  return typed.includes(".") ? amount.startsWith(typed) : amount.slice(0, amount.indexOf(".")) === typed;
}

/**
 * Whether a transaction stays in view. Text matches any part of the name, the note or the
 * category's name, whatever its capitals, spaces and punctuation (as the full search
 * does), or the amount (see matchesAmount). Both the text and the categories must agree.
 */
export function matchesPeriodFilter(
  transaction: Pick<Transaction, "name" | "note" | "amountCents" | "categoryId">,
  filter: PeriodFilter,
  categoryName?: string,
): boolean {
  if (filter.categoryIds.size > 0 && !filter.categoryIds.has(transaction.categoryId ?? NO_CATEGORY)) return false;

  const text = filter.text.trim();
  if (text === "") return true;
  if (matchesAmount(text, transaction.amountCents)) return true;
  // Text that is all punctuation is looked for as typed.
  const key = searchKey(text);
  const normalise = key === "" ? (value: string) => value.toLowerCase() : searchKey;
  const needle = key === "" ? text.toLowerCase() : key;
  return [transaction.name, transaction.note ?? "", categoryName ?? ""].some((field) => normalise(field).includes(needle));
}
