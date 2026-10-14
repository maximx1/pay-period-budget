import { parseMoneyInput } from "../../../shared/money.ts";
import { MAX_TRANSACTION_CENTS } from "../../../shared/transactions.ts";

/** What was typed as a limit, in cents: zero or more ("spend nothing" is a limit). Null if it isn't an amount. */
export function parseLimit(text: string): number | null {
  const cents = parseMoneyInput(text);
  return cents !== null && cents <= MAX_TRANSACTION_CENTS ? cents : null;
}
