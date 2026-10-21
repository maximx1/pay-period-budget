import { dateOf, formatDateRange, formatLongDate } from "../../../shared/dates.ts";
import type { AddWaitingResponse } from "../../../shared/split.ts";

/** What a toast says after a split's waiting payments were added. */
export function addedMessage(name: string, { added, waiting }: AddWaitingResponse): string {
  const first = dateOf(added[0]!.occursAt);
  const last = dateOf(added.at(-1)!.occursAt);
  const what =
    added.length === 1
      ? `Added 1 ${name} payment on ${formatLongDate(first)}`
      : `Added ${added.length} ${name} payments, ${formatDateRange(first, last)}`;
  if (!waiting) return `${what}. That's the last of it`;
  return `${what}. ${waiting.payments.length} still waiting`;
}
