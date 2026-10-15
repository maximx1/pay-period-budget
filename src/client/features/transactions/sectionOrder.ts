import type { Transaction } from "../../../shared/transactions.ts";

/**
 * A section's rows as shown: newest first, later dates and times above earlier ones. Rows
 * at the very same date and time keep the order they arrive in, which is the order chosen
 * with Reorder, so moving one up still moves it up.
 */
export function newestFirst(transactions: readonly Transaction[]): Transaction[] {
  // Array sorting is stable: equal times stay as they were.
  return [...transactions].sort((a, b) => (a.occursAt < b.occursAt ? 1 : a.occursAt > b.occursAt ? -1 : 0));
}
