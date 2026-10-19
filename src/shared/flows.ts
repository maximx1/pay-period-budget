/** What a chart needs of a transaction to add it up. */
export type FlowSource = { amountCents: number; categoryId: string | null; billIncomeId: string | null };

/** One amount for a chart to add up: a transaction as it is, or a transfer's net. */
export type FlowEntry = FlowSource & { transfer: boolean };

/**
 * The amounts a chart adds up over some transactions, usually one pay period's. Money sent
 * to a transfer and brought back from it within them counts once, as the difference: $300
 * sent to savings and $100 brought back is $200 sent. Each transfer becomes one entry per
 * category its transactions are filed under, signed like a transaction, and left out when
 * it comes to nothing; only money under the same category nets. The transactions' own
 * category is the one that counts, as everywhere else, not the transfer's: the two differ
 * when a transaction was filed by hand or the transfer's category changed later.
 * Everything else passes through unchanged, in order, ahead of them.
 *
 * Only for charts and the figures beside them: the transactions themselves stay as they are.
 * `transfers` holds each transfer's id; anything not in it is no transfer.
 */
export function netTransfers(transactions: readonly FlowSource[], transfers: ReadonlySet<string>): FlowEntry[] {
  const entries: FlowEntry[] = [];
  // By transfer, then by category.
  const nets = new Map<string, Map<string | null, number>>();
  for (const { amountCents, categoryId, billIncomeId } of transactions) {
    if (billIncomeId === null || !transfers.has(billIncomeId)) {
      entries.push({ amountCents, categoryId, billIncomeId, transfer: false });
      continue;
    }
    let byCategory = nets.get(billIncomeId);
    if (!byCategory) nets.set(billIncomeId, (byCategory = new Map()));
    byCategory.set(categoryId, (byCategory.get(categoryId) ?? 0) + amountCents);
  }
  for (const [billIncomeId, byCategory] of nets) {
    for (const [categoryId, amountCents] of byCategory) {
      if (amountCents !== 0) entries.push({ amountCents, categoryId, billIncomeId, transfer: true });
    }
  }
  return entries;
}
