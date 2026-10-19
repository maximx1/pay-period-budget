import type { CategoryMoveResponse } from "../../../shared/categories.ts";

/** What to tell the user once everything under `from` has gone to `to`. */
export function moveMessage({ transactions, billsIncome, deleted }: CategoryMoveResponse, from: string, to: string): string {
  const moved = [
    transactions > 0 && (transactions === 1 ? "1 transaction" : `${transactions} transactions`),
    billsIncome > 0 && (billsIncome === 1 ? "1 recurring item" : `${billsIncome} recurring items`),
  ].filter(Boolean);
  const said = moved.length === 0 ? `${from} had nothing filed under it.` : `Moved ${moved.join(" and ")} to ${to}.`;
  return deleted ? `${said} ${from} is deleted.` : said;
}
