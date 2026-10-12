import type { Transaction } from "../../shared/transactions.ts";
import type { TransactionRecord } from "../repos/types.ts";

export function toTransaction(record: TransactionRecord): Transaction {
  return {
    id: record.id,
    name: record.name,
    amountCents: record.amountCents,
    kind: record.amountCents < 0 ? "expense" : "income",
    occursAt: record.occursAt,
    status: record.status,
    paidAt: record.paidAt?.toISOString() ?? null,
    note: record.note,
    sortOrder: record.sortOrder,
    billIncomeId: record.billIncomeId,
    occurrenceDate: record.occurrenceDate,
    importKey: record.importKey,
  };
}
