/** What a chart needs of a transaction to add it up. */
export type FlowSource = { amountCents: number; categoryId: string | null; billIncomeId: string | null };

/** One amount for a chart to add up: a transaction as it is, or a transfer's net. */
export type FlowEntry = FlowSource & { transfer: boolean };

/**
 * The amounts a chart adds up over some transactions, usually one pay period's. Money sent
 * to a transfer and brought back from it within them counts once, as the difference: $300
 * sent to savings and $100 brought back is $200 sent. Each transfer becomes one entry,
 * signed like a transaction, filed under the transfer's own category, and left out when it
 * comes to nothing. Everything else passes through unchanged, in order, ahead of them.
 *
 * Only for charts and the figures beside them: the transactions themselves stay as they are.
 * `transfers` holds each transfer's id with its category; anything not in it is no transfer.
 */
export function netTransfers(
  transactions: readonly FlowSource[],
  transfers: ReadonlyMap<string, { categoryId: string | null }>,
): FlowEntry[] {
  const entries: FlowEntry[] = [];
  const nets = new Map<string, number>();
  for (const { amountCents, categoryId, billIncomeId } of transactions) {
    if (billIncomeId !== null && transfers.has(billIncomeId)) nets.set(billIncomeId, (nets.get(billIncomeId) ?? 0) + amountCents);
    else entries.push({ amountCents, categoryId, billIncomeId, transfer: false });
  }
  for (const [billIncomeId, amountCents] of nets) {
    if (amountCents !== 0) entries.push({ amountCents, categoryId: transfers.get(billIncomeId)!.categoryId, billIncomeId, transfer: true });
  }
  return entries;
}
