// What the review dialog holds for each transaction found in the screenshots, and how
// that becomes an import. Pure, so it can be tested without a screen.

import { isLocalDate } from "../../../shared/dates.ts";
import { centsToInput, parseMoneyInput } from "../../../shared/money.ts";
import { scanImportKey, type ScanFlag, type ScannedRow } from "../../../shared/scan.ts";
import type {
  BillOrIncomeSuggestion,
  ImportRow,
  PossibleDuplicate,
  TransactionImportResponse,
  TransactionKind,
} from "../../../shared/transactions.ts";

const MAX_NAME = 100;

/** One found transaction as the person is reviewing it. Text fields hold what is typed. */
export type Draft = {
  /** Stable, for React. */
  key: string;
  include: boolean;
  name: string;
  /** "YYYY-MM-DD", or "" until one is given. */
  date: string;
  /** Always positive; `kind` says which way. */
  amount: string;
  kind: TransactionKind;
  /** "" for none. */
  billIncomeId: string;
  /** The upcoming entry the dry run says this pays; used only while billIncomeId is still the suggested one. */
  countsToward: string | null;
  suggestion: BillOrIncomeSuggestion | null;
  duplicate: PossibleDuplicate | null;
  /** Left out by the server for its import key: already imported (`held`), or imported and since deleted. */
  skipped: "held" | "deleted" | null;
  flags: ScanFlag[];
  balanceCents: number | null;
  importKey: string | undefined;
};

/** The found rows as drafts, ticked unless something about them wants a look first. */
export function draftsFromRows(rows: readonly ScannedRow[]): Draft[] {
  return rows.map((row, index) => ({
    key: `row-${index}`,
    include: row.flags.length === 0,
    name: row.name.slice(0, MAX_NAME),
    date: row.date ?? "",
    amount: centsToInput(Math.abs(row.amountCents)),
    kind: row.amountCents < 0 ? "expense" : "income",
    billIncomeId: "",
    countsToward: null,
    suggestion: null,
    duplicate: null,
    skipped: null,
    flags: row.flags,
    balanceCents: row.balanceCents,
    importKey: scanImportKey(row),
  }));
}

/** What is wrong with a draft that stops it being imported, or null. */
export function problemWith(draft: Draft): string | null {
  if (!draft.name.trim()) return "Give it a name";
  if (!isLocalDate(draft.date)) return "Give it a date";
  const cents = parseMoneyInput(draft.amount);
  if (cents === null || cents <= 0) return "Give it an amount";
  return null;
}

/** A draft as a row of an import request, or null if it can't be one yet. */
function toImportRow(draft: Draft): ImportRow | null {
  if (problemWith(draft)) return null;
  const tiedAsSuggested = draft.suggestion !== null && draft.billIncomeId === draft.suggestion.billIncomeId;
  return {
    name: draft.name.trim(),
    amountCents: parseMoneyInput(draft.amount)!,
    kind: draft.kind,
    occursAt: `${draft.date}T00:00`,
    // A bank's list shows what has gone through.
    paid: true,
    ...(draft.billIncomeId && { billIncomeId: draft.billIncomeId }),
    ...(tiedAsSuggested && draft.countsToward && { countsToward: draft.countsToward }),
    ...(draft.importKey && { importKey: draft.importKey }),
  };
}

/**
 * The rows to send, and which draft each came from. `only` picks the drafts: for the dry
 * run every one that could be imported, for the import the ticked ones.
 */
export function importRows(drafts: readonly Draft[], only: (draft: Draft) => boolean) {
  const rows: ImportRow[] = [];
  const keys: string[] = [];
  for (const draft of drafts) {
    const row = only(draft) ? toImportRow(draft) : null;
    if (!row) continue;
    rows.push(row);
    keys.push(draft.key);
  }
  return { rows, keys };
}

/**
 * The drafts with what the dry run found: a possible duplicate unticks a row; a row the
 * server would skip as imported before is unticked; the bill or income it probably
 * belongs to is filled in, with the entry it pays when it pays one.
 */
export function withDryRun(drafts: readonly Draft[], keys: readonly string[], result: TransactionImportResponse): Draft[] {
  const at = (index: number) => keys[index];
  const duplicates = new Map(result.possibleDuplicates.map((entry) => [at(entry.index), entry]));
  const suggestions = new Map(result.billOrIncomeSuggestions.map((entry) => [at(entry.index), entry]));
  const skipped = new Map(result.skipped.map((entry) => [at(entry.index), entry.reason]));
  return drafts.map((draft) => {
    const duplicate = duplicates.get(draft.key) ?? null;
    const suggestion = suggestions.get(draft.key) ?? null;
    const skip = skipped.get(draft.key) ?? null;
    return {
      ...draft,
      duplicate,
      suggestion,
      skipped: skip,
      include: draft.include && !duplicate && !skip,
      billIncomeId: suggestion ? suggestion.billIncomeId : draft.billIncomeId,
      countsToward: suggestion?.countsToward ?? null,
    };
  });
}

/** Whether a draft should start open for editing rather than as a one-line summary. */
export const wantsALook = (draft: Draft) => draft.flags.length > 0 || problemWith(draft) !== null;
