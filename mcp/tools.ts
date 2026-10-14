// The tools the MCP server offers. Each is a thin call to one API endpoint, except the
// import, which reads a file from this machine and sends it in pieces. Nothing here knows
// about the MCP protocol: mcpServer.ts registers these, and the tests call them directly.
import { isAbsolute } from "node:path";
import { z } from "zod";
import type { AuthResponse } from "../src/shared/auth.ts";
import type { BudgetResponse, PeriodListResponse, PeriodView } from "../src/shared/budget.ts";
import type { Report } from "../src/shared/reports.ts";
import {
  categoryInputSchema,
  categoryLimitSchema,
  type CategoryListResponse,
  categoryPatchSchema,
  type CategoryResponse,
} from "../src/shared/categories.ts";
import { dateOf, isLocalDate, nowIn, todayIn } from "../src/shared/dates.ts";
import {
  MAX_BILL_OR_INCOME_TRANSACTIONS_PAGE,
  billOrIncomeInputSchema,
  type BillsIncomeListResponse,
  billOrIncomePatchSchema,
  type BillOrIncomePreview,
  type BillOrIncomeResponse,
  type BillOrIncomeTransactionsResponse,
} from "../src/shared/billsIncome.ts";
import {
  DUPLICATE_WINDOW_DAYS,
  type ImportRow,
  importRowSchema,
  MAX_IMPORT_ROWS,
  MAX_SEARCH_PAGE,
  MAX_TRANSACTION_RANGE_DAYS,
  NO_CATEGORY,
  NOTHING_TO_SEARCH_MESSAGE,
  type TransactionSearchResponse,
  type PossibleDuplicate,
  type BillOrIncomeSuggestion,
  type TransactionImportResponse,
  transactionInputSchema,
  type TransactionListResponse,
  transactionPatchSchema,
  type TransactionResponse,
} from "../src/shared/transactions.ts";
import { type Api, ApiRequestError } from "./api.ts";
import {
  billOrIncomeLine,
  categoryLine,
  limitLines,
  money,
  periodReport,
  plural,
  reportText,
  transactionLine,
  transactionList,
} from "./format.ts";

/** Something the caller got wrong, or that could not be done; the message is the tool's answer. */
export class ToolFailure extends Error {}

export type ToolDeps = {
  api: Api;
  /** Reads a text file on this machine. */
  readFile: (path: string) => Promise<string>;
  now: () => Date;
};

export type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  /** It changes nothing on the server. */
  readOnly: boolean;
  /** It removes something that cannot be brought back. */
  destructive: boolean;
  /** Checks the arguments, does the work and returns the text to show. */
  run(args: unknown): Promise<string>;
};

function define<Shape extends z.ZodRawShape>(
  tool: Omit<Tool, "run" | "inputSchema" | "destructive"> & {
    inputSchema: Shape;
    destructive?: boolean;
    run: (args: z.output<z.ZodObject<Shape>>) => Promise<string>;
  },
): Tool {
  const schema = z.object(tool.inputSchema);
  return { ...tool, destructive: tool.destructive ?? false, run: async (args) => tool.run(schema.parse(args ?? {})) };
}

/** The most rows one file may hold; a year of a busy account is a few thousand. */
export const MAX_FILE_ROWS = 20_000;
const MAX_LISTED = 100;

const AMOUNT_RULE = "A positive whole number of cents ($54.12 is 5412); `kind` says which way the money went.";
const DATE_TIME_RULE =
  'Local date and time as "YYYY-MM-DDTHH:mm" in the budget\'s own time zone. Use T00:00 when only the date is known.';

const transactionFields = transactionInputSchema.shape;
const patchFields = transactionPatchSchema.shape;
const billOrIncomeFields = billOrIncomeInputSchema.shape;
const billOrIncomePatchFields = billOrIncomePatchSchema.shape;

const categoryFields = categoryInputSchema.shape;
const categoryPatchFields = categoryPatchSchema.shape;

const BILL_INCOME_ID_RULE = "The id of a bill or income, from list_bills_income.";
const CATEGORY_ID_RULE = "The id of a category, from list_categories.";
const LIMIT_RULE = "A whole number of cents, zero or more ($200.00 is 20000). Zero means nothing may be spent.";
const APPLY_TO_PERIODS_RULE =
  "True also gives the usual limit to the current pay period and every later one that already exists, replacing " +
  "the limit each has (or, when the usual limit is being taken away, removing it). Left out, only pay periods " +
  "created from now on follow. Periods that have ended are never touched: use set_period_limit for those.";
const COUNTS_TOWARD_RULE =
  "The id of an upcoming transaction that a bill or income generated, when this one pays part or all of it. " +
  "That entry shrinks by this amount and is removed once nothing is left, so the bill is not counted twice. " +
  "It also ties this transaction to the same item. Leave it out for a payment on top of the scheduled one.";
const KIND_RULE =
  '"expense" is a bill and "income" is money coming in. "transfer" is another account of the owner\'s own that money ' +
  "is moved to and may come back from: savings, a joint account, a HELOC or other loan. A transfer's transactions go " +
  'either way ("expense" for money sent to it, "income" for money brought back), its own scheduled entries are money ' +
  "out, and it has a balance worked out from them.";
const OPENING_RULE =
  "Only for a transfer: what the other account held before its first transaction in the budget, in whole cents. " +
  "Negative for money owed, such as a loan. It moves no money in any pay period; it only sets where the balance starts.";
const UNIT_RULE =
  '"week", "month" or "year" repeat every `recurrenceInterval` of those from `firstDueDate`; "period" is once every ' +
  'pay period, on its first day (a paycheck); "none" is no schedule at all: nothing is ever added by itself, and the ' +
  "item only gathers the transactions tied to it.";

/** What became of an upcoming entry that was paid toward. */
const towardLine = (name: string, previousCents: number, remainingCents: number) =>
  remainingCents === 0
    ? `${name}: ${money(previousCents)} was due; now paid off, and the upcoming entry is removed`
    : `${name}: ${money(previousCents)} was due; ${money(remainingCents)} is still upcoming`;

function previewText(preview: BillOrIncomePreview, saved: boolean): string {
  const will = saved ? "Added" : "Would add";
  if (preview.transactions === 0) {
    return saved ? "Nothing was added to the pay periods that exist." : "Nothing would be added to the pay periods that exist.";
  }
  const base = `${will} ${plural(preview.transactions, "upcoming transaction")} to ${plural(preview.periods, "existing pay period")}, the earliest on ${preview.earliestDate}.`;
  return preview.pastPeriods === 0
    ? base
    : `${base} ${plural(preview.pastPeriods, "of those periods is", "of those periods are")} already over: the entries arrive unpaid there, ` +
        "and the leftover carried through every later period changes.";
}

const periodLine = (period: { startDate: string; endDate: string; id: string }) =>
  `${period.startDate} to ${period.endDate} (id ${period.id})`;

export function createTools({ api, readFile, now }: ToolDeps): Tool[] {
  async function importTransactions(args: {
    file: string;
    dryRun: boolean;
    addEarlierPeriods: boolean;
    restoreDeleted: boolean;
  }) {
    const rows = await readImportFile(args.file, readFile);
    const chunks: ImportRow[][] = [];
    for (let i = 0; i < rows.length; i += MAX_IMPORT_ROWS) chunks.push(rows.slice(i, i + MAX_IMPORT_ROWS));
    const keyless = rows.filter((row) => row.importKey === undefined).length;

    if (!args.dryRun && chunks.length > 1 && keyless > 0) {
      throw new ToolFailure(
        `${plural(keyless, "row has", "rows have")} no importKey. A file this size is sent in ${chunks.length} requests, ` +
          "and if one fails the import has to be run again, which would add those rows a second time. " +
          "Give every row an importKey. Nothing was imported.",
      );
    }

    const send = (chunk: ImportRow[], dryRun: boolean) =>
      api.post<TransactionImportResponse>("/api/transactions/import", {
        dryRun,
        addEarlierPeriods: args.addEarlierPeriods,
        restoreDeleted: args.restoreDeleted,
        transactions: chunk,
      });

    // Every piece is tried as a dry run first, so a problem anywhere in the file is found
    // before anything is saved.
    const previews: TransactionImportResponse[] = [];
    const problems: string[] = [];
    for (const [index, chunk] of chunks.entries()) {
      try {
        previews.push(await send(chunk, true));
      } catch (error) {
        if (!(error instanceof ApiRequestError) || !error.fields) throw error;
        problems.push(...rowProblems(error.fields, index * MAX_IMPORT_ROWS, rows));
      }
    }
    if (problems.length > 0) {
      const hint = problems.some((problem) => problem.includes("before your"))
        ? "\n\nRows dated before the earliest pay period need addEarlierPeriods: true, which adds the periods to hold them."
        : "";
      throw new ToolFailure(
        `The server would refuse ${plural(problems.length, "row")} of ${rows.length}. Nothing was imported.\n` +
          listed(problems) +
          hint,
      );
    }
    if (args.dryRun) return importReport(rows, previews, { saved: false, keyless });

    const results: TransactionImportResponse[] = [];
    for (const [index, chunk] of chunks.entries()) {
      try {
        results.push(await send(chunk, false));
      } catch (error) {
        const first = index * MAX_IMPORT_ROWS;
        const saved = results.reduce((sum, result) => sum + result.created, 0);
        throw new ToolFailure(
          `The import stopped at rows ${first} to ${first + chunk.length - 1}: ${error instanceof Error ? error.message : String(error)}\n` +
            (index === 0
              ? "Nothing was imported."
              : `Rows 0 to ${first - 1} are saved (${plural(saved, "transaction")}). Run the same file again to finish: ` +
                "rows already saved are skipped by their import keys."),
        );
      }
    }
    return importReport(rows, results, { saved: true, keyless });
  }

  return [
    define({
      name: "get_budget",
      title: "Budget overview",
      description:
        "How the budget is set up: the pay schedule, the date the first pay period began, the opening balance, " +
        "the budget's time zone and today's date in that zone. Call this first. All dates in every other tool are " +
        "wall-clock dates in that time zone.",
      inputSchema: {},
      readOnly: true,
      async run() {
        const [{ user }, { budget }] = await Promise.all([
          api.get<AuthResponse>("/api/auth/me"),
          api.get<BudgetResponse>("/api/budget"),
        ]);
        if (!budget) return `Account: ${user.username}\nNo budget has been set up yet. That is done in the app.`;
        return [
          `Account: ${user.username}`,
          `Pay schedule: ${budget.type}, first pay period began ${budget.anchorDate}`,
          `Opening balance on that day: ${money(budget.openingCents)}`,
          `Time zone: ${budget.timezone}`,
          `Now in that zone: ${nowIn(budget.timezone, now()).replace("T", " ")}`,
        ].join("\n");
      },
    }),

    define({
      name: "list_periods",
      title: "List pay periods",
      description:
        "Every pay period that exists, oldest first, with its dates and id. Periods are created as they are needed, " +
        "so the list ends where the data ends. Use get_period for a period's amounts and transactions.",
      inputSchema: {},
      readOnly: true,
      async run() {
        const [{ periods }, { budget }] = await Promise.all([
          api.get<PeriodListResponse>("/api/periods"),
          api.get<BudgetResponse>("/api/budget"),
        ]);
        const today = budget ? todayIn(budget.timezone, now()) : null;
        const lines = periods.map((period) => {
          const current = today !== null && period.startDate <= today && today <= period.endDate;
          return `- ${periodLine(period)}${current ? " (the current period)" : ""}`;
        });
        return [`${plural(periods.length, "pay period")}:`, ...lines].join("\n");
      },
    }),

    define({
      name: "get_period",
      title: "One pay period",
      description:
        "One pay period: its starting amount, totals, category limits and every transaction in it. Give `id`, or a `date` to get the " +
        'period containing it, or neither for the current period. "Leftover so far" is the starting amount plus paid ' +
        "transactions and should match the bank balance; \"projected leftover\" also counts upcoming ones and is what the " +
        "next period starts with. A limit line marked OVER is what the owner sees as a warning on that period.",
      inputSchema: {
        id: z.string().min(1).optional().describe("A period id from list_periods."),
        date: z.string().refine(isLocalDate, "Use YYYY-MM-DD").optional().describe("YYYY-MM-DD. The period containing this date."),
      },
      readOnly: true,
      async run({ id, date }) {
        if (id && date) throw new ToolFailure("Give an id or a date, not both.");
        if (id) return periodReport(await api.get<PeriodView>(`/api/periods/${encodeURIComponent(id)}`));
        if (!date) return periodReport(await api.get<PeriodView>("/api/periods/current"));

        const { periods } = await api.get<PeriodListResponse>("/api/periods");
        const found = periods.find((period) => period.startDate <= date && date <= period.endDate);
        if (!found) {
          const span = periods.length ? `${periods[0]!.startDate} to ${periods.at(-1)!.endDate}` : "nothing yet";
          throw new ToolFailure(
            `No pay period covers ${date}. Existing periods run from ${span}. A period is created when a transaction is dated in it.`,
          );
        }
        return periodReport(await api.get<PeriodView>(`/api/periods/${found.id}`));
      },
    }),

    define({
      name: "list_transactions",
      title: "Transactions by date",
      description:
        `Transactions dated from \`from\` through \`to\`, both included, at most ${MAX_TRANSACTION_RANGE_DAYS} days per call. ` +
        "Each line ends with the transaction's id and says whether it was generated from a bill or income or imported. " +
        "Use this to compare a bank export with what the budget already holds.",
      inputSchema: {
        from: z.string().describe("YYYY-MM-DD, the first day."),
        to: z.string().describe("YYYY-MM-DD, the last day."),
      },
      readOnly: true,
      async run({ from, to }) {
        const query = new URLSearchParams({ from, to });
        const { transactions } = await api.get<TransactionListResponse>(`/api/transactions?${query}`);
        const net = transactions.reduce((sum, transaction) => sum + transaction.amountCents, 0);
        return [
          `${plural(transactions.length, "transaction")} from ${from} to ${to}, net ${money(net)}:`,
          transactionList(transactions),
        ].join("\n");
      },
    }),

    define({
      name: "search_transactions",
      title: "Search transactions",
      description:
        "Finds transactions in any pay period, newest first, with how many matched and what they add up to. " +
        "`q` matches any part of the name or the note, whatever its capitals. Give at least one of q, categoryId, from " +
        `and to; everything given must match. Up to ${MAX_SEARCH_PAGE} per call; pass the cursor it gives as \`before\` for older ones. ` +
        "Unlike list_transactions there is no limit on the span of dates.",
      inputSchema: {
        q: z.string().optional().describe('Words to look for, such as "kroger". Up to 100 characters.'),
        categoryId: z
          .string()
          .optional()
          .describe(`${CATEGORY_ID_RULE} Or "${NO_CATEGORY}" for transactions filed under no category.`),
        from: z.string().optional().describe("YYYY-MM-DD, the first day to look in."),
        to: z.string().optional().describe("YYYY-MM-DD, the last day to look in."),
        limit: z.number().int().min(1).max(MAX_SEARCH_PAGE).default(50).describe("How many to return."),
        before: z.string().optional().describe("The cursor from the previous call, for the next older page."),
      },
      readOnly: true,
      async run({ q, categoryId, from, to, limit, before }) {
        if (![q?.trim(), categoryId, from, to].some(Boolean)) throw new ToolFailure(`${NOTHING_TO_SEARCH_MESSAGE}.`);
        const query = new URLSearchParams({ limit: String(limit) });
        for (const [key, value] of Object.entries({ q, categoryId, from, to, before })) if (value) query.set(key, value);
        const { transactions, nextCursor, totals } = await api.get<TransactionSearchResponse>(`/api/transactions/search?${query}`);
        return [
          `${plural(totals.count, "transaction")} found: ${money(totals.outCents)} out, ${money(totals.inCents)} in.`,
          ...(totals.count === 0
            ? []
            : [`${transactions.length === totals.count ? "All of them" : `These ${transactions.length}`}, newest first:`, transactionList(transactions)]),
          ...(nextCursor ? [`There are older ones. Call again with before: "${nextCursor}"`] : []),
        ].join("\n");
      },
    }),

    define({
      name: "get_report",
      title: "Report over a span of pay periods",
      description:
        "Adds up the pay periods that share at least one day with `from`..`to`, whole: income, expenses and leftover " +
        "for each one, then money out by category and by bill, category limits that were passed, the names most was " +
        "spent under, and anything from before today still marked upcoming. Paid and upcoming transactions both count. " +
        "Use it to answer questions about trends, rather than adding transactions up by hand.",
      inputSchema: {
        from: z.string().describe("YYYY-MM-DD, the first day."),
        to: z.string().describe("YYYY-MM-DD, the last day."),
      },
      readOnly: true,
      async run({ from, to }) {
        return reportText(await api.get<Report>(`/api/reports?${new URLSearchParams({ from, to })}`));
      },
    }),

    define({
      name: "create_transaction",
      title: "Add a transaction",
      description:
        "Adds one transaction. For more than a handful, write them to a file and use import_transactions instead. " +
        "Adding one changes the starting amount of every later pay period.",
      inputSchema: {
        name: transactionFields.name.describe("What it was, as it should read in the budget."),
        amountCents: transactionFields.amountCents.describe(AMOUNT_RULE),
        kind: transactionFields.kind.describe('"expense" for money out, "income" for money in.'),
        occursAt: transactionFields.occursAt.describe(DATE_TIME_RULE),
        note: transactionFields.note.describe("Optional. Up to 500 characters."),
        paid: transactionFields.paid.describe(
          "True if the money has already moved (anything from a bank statement). Left out, it is an upcoming transaction.",
        ),
        billIncomeId: transactionFields.billIncomeId.describe(
          `${BILL_INCOME_ID_RULE} Ties this transaction to that item, as a payment or receipt in addition to whatever the item schedules.`,
        ),
        countsToward: transactionFields.countsToward.describe(COUNTS_TOWARD_RULE),
        categoryId: transactionFields.categoryId.describe(
          `${CATEGORY_ID_RULE} Files the transaction under it. Left out, a transaction tied to a bill or income takes ` +
            "that item's category, if it has one; null files it under none.",
        ),
      },
      readOnly: false,
      async run(input) {
        const { transaction, period, countedToward } = await api.post<TransactionResponse>("/api/transactions", input);
        return [
          `Added: ${transactionLine(transaction)}`,
          `In the period ${periodLine(period)}`,
          ...(countedToward
            ? [`Counted toward ${towardLine(countedToward.name, countedToward.previousCents, countedToward.remainingCents)}.`]
            : []),
        ].join("\n");
      },
    }),

    define({
      name: "update_transaction",
      title: "Change a transaction",
      description:
        "Changes one transaction; give only the fields that change: its details, whether it is paid, which bill or income " +
        "it is tied to, or which category it is filed under. Changing the date moves it to the period that covers the new date.",
      inputSchema: {
        id: z.string().min(1).describe("The transaction's id, from list_transactions or get_period."),
        name: patchFields.name,
        amountCents: patchFields.amountCents.describe(AMOUNT_RULE),
        kind: patchFields.kind.describe('"expense" or "income". Only needed to turn one into the other.'),
        occursAt: patchFields.occursAt.describe(DATE_TIME_RULE),
        note: patchFields.note.describe("An empty string or null removes the note."),
        status: patchFields.status.describe('"paid" once the money has moved, "upcoming" if it has not.'),
        billIncomeId: patchFields.billIncomeId.describe(`${BILL_INCOME_ID_RULE} Ties it to that item; null unties it.`),
        categoryId: patchFields.categoryId.describe(`${CATEGORY_ID_RULE} Files it under that category; null files it under none.`),
      },
      readOnly: false,
      async run({ id, ...patch }) {
        if (Object.values(patch).every((value) => value === undefined)) {
          throw new ToolFailure("Give at least one field to change.");
        }
        const { transaction, period } = await api.patch<TransactionResponse>(
          `/api/transactions/${encodeURIComponent(id)}`,
          patch,
        );
        return `Changed: ${transactionLine(transaction)}\nIn the period ${periodLine(period)}`;
      },
    }),

    define({
      name: "delete_transaction",
      title: "Delete a transaction",
      description:
        "Deletes one transaction for good. There is no undo. If it was imported, its key is remembered and later " +
        "imports skip that row, so it stays deleted.",
      inputSchema: { id: z.string().min(1).describe("The transaction's id.") },
      readOnly: false,
      destructive: true,
      async run({ id }) {
        await api.delete(`/api/transactions/${encodeURIComponent(id)}`);
        return `Deleted transaction ${id}.`;
      },
    }),

    define({
      name: "list_bills_income",
      title: "Bills and income",
      description:
        "The bills and income the budget knows about. One with a schedule is added by itself as an " +
        "upcoming transaction, one per occurrence, whenever a pay period is created; one with no schedule only gathers " +
        "the transactions tied to it. A transfer is another account of the owner's own, with money going both ways. A bank row for a scheduled one usually matches an upcoming transaction that " +
        "already exists: import it with countsToward rather than adding a second.",
      inputSchema: {
        includeArchived: z.boolean().default(false).describe("Also list items whose end date has passed."),
      },
      readOnly: true,
      async run({ includeArchived }) {
        const { items } = await api.get<BillsIncomeListResponse>("/api/bills-income");
        const shown = includeArchived ? items : items.filter((item) => !item.archived);
        if (shown.length === 0) return "No bills or income yet.";
        return [`${plural(shown.length, "bill or income", "bills and income")}:`, ...shown.map((item) => `- ${billOrIncomeLine(item)}`)].join("\n");
      },
    }),

    define({
      name: "list_bill_or_income_transactions",
      title: "A bill or income's transactions",
      description:
        "Everything tied to one bill or income, newest first: the entries it generated and the transactions tied to it " +
        `afterwards, with totals over all of them. Up to ${MAX_BILL_OR_INCOME_TRANSACTIONS_PAGE} per call; pass the cursor it ` +
        "gives as `before` for older ones.",
      inputSchema: {
        id: z.string().min(1).describe(BILL_INCOME_ID_RULE),
        limit: z.number().int().min(1).max(MAX_BILL_OR_INCOME_TRANSACTIONS_PAGE).default(30).describe("How many to return."),
        before: z.string().optional().describe("The cursor from the previous call, for the next older page."),
      },
      readOnly: true,
      async run({ id, limit, before }) {
        const query = new URLSearchParams({ limit: String(limit), ...(before && { before }) });
        const { transactions, nextCursor, totals } = await api.get<BillOrIncomeTransactionsResponse>(
          `/api/bills-income/${encodeURIComponent(id)}/transactions?${query}`,
        );
        return [
          `${plural(totals.count, "transaction")} tied to this item in all: paid ${money(totals.paidCents)}, upcoming ${money(totals.upcomingCents)}.`,
          // Only a transfer has a balance.
          ...(totals.balanceCents === null
            ? []
            : [
                `Sent to it ${money(totals.paidOutCents)}, brought back ${money(totals.paidInCents)}, balance ${money(totals.balanceCents)}` +
                  `${totals.balanceCents < 0 ? " (owed)" : ""}: its starting balance, plus what was sent, less what came back, paid transactions only.`,
              ]),
          `${transactions.length === totals.count ? "All of them" : `These ${transactions.length}`}, newest first:`,
          transactionList(transactions),
          ...(nextCursor ? [`There are older ones. Call again with before: "${nextCursor}"`] : []),
        ].join("\n");
      },
    }),

    define({
      name: "create_bill_or_income",
      title: "Add a bill or income",
      description:
        "Adds a bill or an income the budget should know about. With a schedule, the budget adds an upcoming transaction " +
        "for each occurrence by itself, in every pay period from the first due date on; a first due date in the past " +
        "therefore fills in periods that are already over. dryRun defaults to true and reports what would be added " +
        "without saving; show the owner, then call again with dryRun: false.",
      inputSchema: {
        name: billOrIncomeFields.name,
        kind: billOrIncomeFields.kind.describe(KIND_RULE),
        openingCents: billOrIncomeFields.openingCents.describe(OPENING_RULE),
        defaultAmountCents: billOrIncomeFields.defaultAmountCents.describe(
          'The usual amount, as a positive whole number of cents. 0 ("no usual amount") only with recurrenceUnit "none".',
        ),
        recurrenceUnit: billOrIncomeFields.recurrenceUnit.describe(UNIT_RULE),
        recurrenceInterval: billOrIncomeFields.recurrenceInterval.describe('Every this many weeks, months or years. Ignored for "period" and "none".'),
        firstDueDate: billOrIncomeFields.firstDueDate.describe('YYYY-MM-DD. The first occurrence; it also fixes the weekday or day of the month. Not used with "none".'),
        endDate: billOrIncomeFields.endDate.describe("YYYY-MM-DD, or left out. No occurrences after this date."),
        description: billOrIncomeFields.description.describe("Optional notes: an account number, a link to pay it."),
        categoryId: billOrIncomeFields.categoryId.describe(
          `${CATEGORY_ID_RULE} Every entry the item adds, and every transaction tied to it without a category of its own, is filed under it.`,
        ),
        dryRun: z.boolean().default(true).describe("True (the default) reports without saving. False saves."),
      },
      readOnly: false,
      async run({ dryRun, ...input }) {
        const preview = await api.post<BillOrIncomePreview>("/api/bills-income/preview", input);
        if (dryRun) {
          return [
            `DRY RUN: nothing was saved. ${previewText(preview, false)}`,
            "To add it, call create_bill_or_income again with dryRun: false.",
          ].join("\n");
        }
        const { item } = await api.post<BillOrIncomeResponse>("/api/bills-income", input);
        return `Added: ${billOrIncomeLine(item)}\n${previewText(preview, true)}`;
      },
    }),

    define({
      name: "update_bill_or_income",
      title: "Change a bill or income",
      description:
        "Changes a bill or income; give only the fields that change. It never touches transactions that already exist: " +
        "a new amount, schedule or category applies to what it adds from now on. The one exception is " +
        "applyToTransactions, which files everything already tied to it under its category. To turn a bill that is really a savings " +
        'account or a loan into a transfer, send kind: "transfer" (and openingCents if it held something already): ' +
        "everything tied to it stays tied, and its balance is worked out from those transactions at once.",
      inputSchema: {
        id: z.string().min(1).describe(BILL_INCOME_ID_RULE),
        name: billOrIncomePatchFields.name,
        kind: billOrIncomePatchFields.kind.describe(KIND_RULE),
        openingCents: billOrIncomePatchFields.openingCents.describe(
          `${OPENING_RULE} A transfer with one must be sent openingCents: 0 in the same call that turns it into a bill or an income.`,
        ),
        defaultAmountCents: billOrIncomePatchFields.defaultAmountCents.describe("Positive whole cents."),
        recurrenceUnit: billOrIncomePatchFields.recurrenceUnit.describe(UNIT_RULE),
        recurrenceInterval: billOrIncomePatchFields.recurrenceInterval,
        firstDueDate: billOrIncomePatchFields.firstDueDate.describe("YYYY-MM-DD."),
        endDate: billOrIncomePatchFields.endDate.describe("YYYY-MM-DD, or null for no end."),
        description: billOrIncomePatchFields.description,
        categoryId: billOrIncomePatchFields.categoryId.describe(
          `${CATEGORY_ID_RULE} What it adds from now on is filed under it; null takes its category away.`,
        ),
        applyToTransactions: billOrIncomePatchFields.applyToTransactions.describe(
          "True also files every transaction already tied to this item under its category (or under none, if it has " +
            "none), replacing whatever category each of them had. Ask the owner before using it.",
        ),
      },
      readOnly: false,
      async run({ id, ...patch }) {
        if (Object.values(patch).every((value) => value === undefined)) {
          throw new ToolFailure("Give at least one field to change.");
        }
        const { item, refiledTransactions } = await api.patch<BillOrIncomeResponse>(
          `/api/bills-income/${encodeURIComponent(id)}`,
          patch,
        );
        const existing =
          refiledTransactions === undefined
            ? "Transactions that already exist are as they were."
            : `${plural(refiledTransactions, "transaction")} already tied to it ${refiledTransactions === 1 ? "was" : "were"} ` +
              `${item.categoryId ? `filed under category ${item.categoryId}` : "left with no category"}; nothing else about them changed.`;
        return `Changed: ${billOrIncomeLine(item)}\n${existing}`;
      },
    }),

    define({
      name: "end_bill_or_income",
      title: "End a bill or income",
      description:
        "Stops a bill or income from today: it produces nothing further and is archived from tomorrow. Its past " +
        "transactions stay. Use this, not delete, for a bill that has simply finished.",
      inputSchema: {
        id: z.string().min(1).describe(BILL_INCOME_ID_RULE),
        removeUpcoming: z
          .boolean()
          .describe(
            "True also deletes the upcoming transactions it generated that are dated after today. " +
              "False leaves them for the owner to deal with. Transactions tied to it by hand are never removed.",
          ),
      },
      readOnly: false,
      destructive: true,
      async run({ id, removeUpcoming }) {
        const { item } = await api.post<BillOrIncomeResponse>(`/api/bills-income/${encodeURIComponent(id)}/end`, { removeUpcoming });
        return `Ended: ${billOrIncomeLine(item)}`;
      },
    }),

    define({
      name: "delete_bill_or_income",
      title: "Delete a bill or income",
      description:
        "Deletes a bill or income for good. Its transactions stay in the budget but are no longer tied to anything, " +
        "and what the import had learned about it is lost. There is no undo. Prefer end_bill_or_income.",
      inputSchema: { id: z.string().min(1).describe(BILL_INCOME_ID_RULE) },
      readOnly: false,
      destructive: true,
      async run({ id }) {
        await api.delete(`/api/bills-income/${encodeURIComponent(id)}`);
        return `Deleted bill or income ${id}. Its transactions remain, untied.`;
      },
    }),

    define({
      name: "list_categories",
      title: "Categories",
      description:
        "The categories transactions are filed under, such as Groceries. A transaction has at most one. A category may " +
        "have a usual limit: each pay period gets its own copy of it when the period is created, and get_period " +
        "reports what has been spent against it and whether the period is over.",
      inputSchema: {},
      readOnly: true,
      async run() {
        const { categories } = await api.get<CategoryListResponse>("/api/categories");
        if (categories.length === 0) return "No categories yet.";
        return [`${plural(categories.length, "category", "categories")}:`, ...categories.map((category) => `- ${categoryLine(category)}`)].join("\n");
      },
    }),

    define({
      name: "create_category",
      title: "Add a category",
      description:
        "Adds a category to file transactions under. Names are unique whatever their capitals. A usual limit is " +
        "optional; with one, every pay period created from now on starts with that limit for the category.",
      inputSchema: {
        name: categoryFields.name,
        defaultLimitCents: categoryFields.defaultLimitCents.describe(`The usual limit for each pay period. ${LIMIT_RULE} Left out or null, there is none.`),
        applyToPeriods: categoryFields.applyToPeriods.describe(APPLY_TO_PERIODS_RULE),
      },
      readOnly: false,
      async run(input) {
        const { category } = await api.post<CategoryResponse>("/api/categories", input);
        return `Added: ${categoryLine(category)}`;
      },
    }),

    define({
      name: "update_category",
      title: "Change a category",
      description:
        "Renames a category or changes its usual limit; give only what changes. A new usual limit by itself applies " +
        "only to pay periods created from now on; applyToPeriods brings the current and later ones into line too.",
      inputSchema: {
        id: z.string().min(1).describe(CATEGORY_ID_RULE),
        name: categoryPatchFields.name,
        defaultLimitCents: categoryPatchFields.defaultLimitCents.describe(`${LIMIT_RULE} null takes the usual limit away.`),
        applyToPeriods: categoryPatchFields.applyToPeriods.describe(APPLY_TO_PERIODS_RULE),
      },
      readOnly: false,
      async run({ id, ...patch }) {
        if (Object.values(patch).every((value) => value === undefined)) {
          throw new ToolFailure("Give at least one field to change.");
        }
        const { category } = await api.patch<CategoryResponse>(`/api/categories/${encodeURIComponent(id)}`, patch);
        return `Changed: ${categoryLine(category)}`;
      },
    }),

    define({
      name: "delete_category",
      title: "Delete a category",
      description:
        "Deletes a category for good. Its transactions and its bills and income stay, filed under nothing, and its " +
        "limits are removed from every pay period. There is no undo.",
      inputSchema: { id: z.string().min(1).describe(CATEGORY_ID_RULE) },
      readOnly: false,
      destructive: true,
      async run({ id }) {
        await api.delete(`/api/categories/${encodeURIComponent(id)}`);
        return `Deleted category ${id}. What was filed under it remains, with no category.`;
      },
    }),

    define({
      name: "set_period_limit",
      title: "Set a pay period's limit for a category",
      description:
        "Gives one pay period a limit for a category, or changes the one it has. It affects that period only and " +
        "moves no money. This is how a period that is already over, or one from before the budget began, gets a " +
        "limit: they are never given one automatically. The category's usual limit is not changed.",
      inputSchema: {
        periodId: z.string().min(1).describe("A period id from list_periods or get_period."),
        categoryId: z.string().min(1).describe(CATEGORY_ID_RULE),
        limitCents: categoryLimitSchema.shape.limitCents.describe(LIMIT_RULE),
      },
      readOnly: false,
      async run({ periodId, categoryId, limitCents }) {
        const view = await api.put<PeriodView>(
          `/api/periods/${encodeURIComponent(periodId)}/limits/${encodeURIComponent(categoryId)}`,
          { limitCents },
        );
        return [`Period ${view.period.startDate} to ${view.period.endDate} now has:`, ...limitLines(view.categoryLimits)].join("\n");
      },
    }),

    define({
      name: "remove_period_limit",
      title: "Remove a pay period's limit for a category",
      description:
        "Takes one pay period's limit for a category away. That period only; the category's usual limit and every " +
        "other period's limit stay as they are. set_period_limit puts one back.",
      inputSchema: {
        periodId: z.string().min(1).describe("A period id from list_periods or get_period."),
        categoryId: z.string().min(1).describe(CATEGORY_ID_RULE),
      },
      readOnly: false,
      async run({ periodId, categoryId }) {
        const view = await api.delete<PeriodView>(
          `/api/periods/${encodeURIComponent(periodId)}/limits/${encodeURIComponent(categoryId)}`,
        );
        return [`Removed. Period ${view.period.startDate} to ${view.period.endDate} now has:`, ...limitLines(view.categoryLimits)].join("\n");
      },
    }),

    define({
      name: "import_transactions",
      title: "Import transactions from a file",
      description:
        "Imports many transactions from a JSON file on this machine. Convert a bank export to that file with a script; " +
        "never retype amounts by hand.\n\n" +
        'The file is a JSON array of rows: {"name": string, "amountCents": positive integer, "kind": "expense" | "income", ' +
        '"occursAt": "YYYY-MM-DDTHH:mm", "paid": true, "note"?: string, "importKey"?: string, "billIncomeId"?: string, ' +
        '"countsToward"?: string, "categoryId"?: string | null}. Put the bank\'s own description in note: it is how the import learns which rows ' +
        "belong to which bill or income. " +
        "Set paid: true for anything that has already cleared. importKey is your own stable name for the row (the bank's " +
        "transaction id, or date + amount + description + a counter among identical rows): a row whose key was imported " +
        "before is skipped, so the same file, or an overlapping export, can be imported again safely. A row whose " +
        "transaction the owner later deleted is skipped too, so it does not come back.\n\n" +
        "billIncomeId ties a row to a bill or income. countsToward says the row pays an upcoming entry that an item " +
        "generated: the entry is replaced by the real payment instead of both being counted. categoryId files a row " +
        "under a category from list_categories; a row tied to a bill or income takes that item's category when it " +
        "names none, and null says none. The server suggests no categories: decide them in the script.\n\n" +
        "dryRun defaults to true: it reports what would happen and saves nothing. Read the report. It suggests which " +
        "rows belong to which bill or income and lists rows that may repeat something already in the budget; act on " +
        "those by adding billIncomeId or countsToward to rows, or taking rows out, in the file (better: in the script " +
        "that writes it). Run the dry run again, show the owner the effect on today's figures, and only then call again " +
        "with dryRun: false. The import is all or nothing: one bad row and nothing is saved.",
      inputSchema: {
        file: z.string().min(1).describe("Absolute path of the JSON file."),
        dryRun: z.boolean().default(true).describe("True (the default) reports without saving. False saves."),
        addEarlierPeriods: z
          .boolean()
          .default(false)
          .describe(
            "Allow rows dated before the earliest pay period by adding the periods they need. " +
              "Those periods are history: they do not change today's figures.",
          ),
        restoreDeleted: z
          .boolean()
          .default(false)
          .describe(
            "Import rows even if the owner deleted the transaction once imported under the same key. " +
              "Only when the owner asks for a deleted transaction back.",
          ),
      },
      readOnly: false,
      run: importTransactions,
    }),
  ];
}

/** Reads and checks the file; every row is validated here so problems are reported by row before anything is sent. */
async function readImportFile(file: string, readFile: ToolDeps["readFile"]): Promise<ImportRow[]> {
  if (!isAbsolute(file)) throw new ToolFailure(`Give the file's absolute path. "${file}" is relative.`);

  let text: string;
  try {
    text = await readFile(file);
  } catch (error) {
    throw new ToolFailure(`Couldn't read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ToolFailure(`${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { transactions?: unknown } | null)?.transactions;
  if (!Array.isArray(list)) {
    throw new ToolFailure("The file must hold a JSON array of rows (or an object with a `transactions` array).");
  }
  if (list.length === 0) throw new ToolFailure("The file has no rows.");
  if (list.length > MAX_FILE_ROWS) {
    throw new ToolFailure(`The file has ${list.length} rows; the most one file may hold is ${MAX_FILE_ROWS}. Split it.`);
  }

  const rows: ImportRow[] = [];
  const problems: string[] = [];
  const firstUse = new Map<string, number>();
  for (const [index, candidate] of list.entries()) {
    const result = importRowSchema.safeParse(candidate);
    if (!result.success) {
      for (const issue of result.error.issues) {
        problems.push(`row ${index}: ${issue.path.join(".") || "row"}: ${issue.message}`);
      }
      continue;
    }
    const key = result.data.importKey;
    if (key !== undefined) {
      const earlier = firstUse.get(key);
      if (earlier !== undefined) problems.push(`row ${index}: importKey: row ${earlier} has the same key "${key}"`);
      else firstUse.set(key, index);
    }
    rows.push(result.data);
  }
  if (problems.length > 0) {
    throw new ToolFailure(
      `${plural(problems.length, "problem")} in ${file} (rows are counted from 0). Nothing was sent.\n${listed(problems)}`,
    );
  }
  return rows;
}

const listed = (lines: string[]) =>
  lines.length <= MAX_LISTED
    ? lines.map((line) => `- ${line}`).join("\n")
    : [...lines.slice(0, MAX_LISTED).map((line) => `- ${line}`), `- and ${lines.length - MAX_LISTED} more`].join("\n");

/** Turns the server's "transactions.17.occursAt" into "row 517: occursAt: …" for the row's place in the file. */
function rowProblems(fields: Record<string, string>, offset: number, rows: ImportRow[]): string[] {
  return Object.entries(fields).map(([path, message]) => {
    const match = /^transactions\.(\d+)\.(.+)$/.exec(path);
    if (!match) return `${path}: ${message}`;
    const index = offset + Number(match[1]);
    const row = rows[index];
    return `row ${index}${row ? ` (${dateOf(row.occursAt)} ${row.name})` : ""}: ${match[2]}: ${message}`;
  });
}

function importReport(
  rows: ImportRow[],
  results: TransactionImportResponse[],
  { saved, keyless }: { saved: boolean; keyless: number },
): string {
  const created = results.reduce((sum, result) => sum + result.created, 0);
  const skippedFor = (reason: "held" | "deleted") =>
    results.reduce((sum, result) => sum + result.skipped.filter((row) => row.reason === reason).length, 0);
  const [held, deleted] = [skippedFor("held"), skippedFor("deleted")];
  // A dry run undoes each piece, so every piece adds the same periods again: the most any
  // one needed is what a real run would add. A real run adds them once, piece by piece.
  const added = (end: "earlier" | "later") =>
    saved
      ? results.reduce((sum, result) => sum + result.periodsAdded[end], 0)
      : Math.max(...results.map((result) => result.periodsAdded[end]));

  // Periods a dry run would create have a different id each time; their dates identify them.
  const periods = new Map<string, { startDate: string; endDate: string; count: number; netCents: number }>();
  for (const period of results.flatMap((result) => result.periods)) {
    const tally = periods.get(period.startDate) ?? { startDate: period.startDate, endDate: period.endDate, count: 0, netCents: 0 };
    tally.count += period.count;
    tally.netCents += period.netCents;
    periods.set(period.startDate, tally);
  }

  const suggestions = results.flatMap((result, index) =>
    result.billOrIncomeSuggestions.map((suggestion) => ({ ...suggestion, index: suggestion.index + index * MAX_IMPORT_ROWS })),
  );
  // A row that matches an expected bill is listed once, with what to do about it, under the suggestions.
  const matchesExpectedBill = new Set(suggestions.filter((suggestion) => suggestion.countsToward).map((suggestion) => suggestion.index));

  // Rows of this file already saved by an earlier piece are not duplicates of each other.
  const ownKeys = new Set(rows.flatMap((row) => (row.importKey === undefined ? [] : [row.importKey])));
  const duplicates = results
    .flatMap((result, index) =>
      result.possibleDuplicates
        .filter(({ reason, existing }) => !(reason === "imported" && existing.importKey !== null && ownKeys.has(existing.importKey)))
        .map((duplicate) => ({ ...duplicate, index: duplicate.index + index * MAX_IMPORT_ROWS })),
    )
    .filter((duplicate) => !matchesExpectedBill.has(duplicate.index));

  // Entries paid toward. Whether each piece was undone (a dry run, where two pieces paying
  // one entry each start from the full amount) or saved (where the second starts from what
  // the first left), what each piece took off adds up to the true total.
  const toward = new Map<string, { name: string; previousCents: number; paidCents: number }>();
  for (const entry of results.flatMap((result) => result.countedToward)) {
    const took = Math.abs(entry.previousCents) - Math.abs(entry.remainingCents);
    const seen = toward.get(entry.id);
    if (seen) seen.paidCents += took;
    else toward.set(entry.id, { name: entry.name, previousCents: entry.previousCents, paidCents: took });
  }

  const lines: string[] = [
    saved
      ? `Imported ${plural(created, "transaction")} of the ${rows.length} in the file.`
      : `DRY RUN: nothing was saved. ${plural(created, "transaction")} of the ${rows.length} in the file would be imported.`,
  ];
  if (held > 0) {
    lines.push(`${plural(held, "row was", "rows were")} skipped because ${held === 1 ? "its" : "their"} import key is already in the budget.`);
  }
  if (deleted > 0) {
    lines.push(
      `${plural(deleted, "row was", "rows were")} skipped because the owner deleted ${deleted === 1 ? "that transaction" : "those transactions"} from the budget. ` +
        "Run with restoreDeleted: true only if the owner wants them back.",
    );
  }
  if (keyless > 0 && !saved) {
    lines.push(`${plural(keyless, "row has", "rows have")} no importKey: importing this file twice would add ${keyless === 1 ? "it" : "them"} twice.`);
  }
  if (added("earlier") > 0 || added("later") > 0) {
    lines.push(
      `Pay periods ${saved ? "added" : "that would be added"}: ${added("earlier")} before the earliest, ${added("later")} after the latest. ` +
        "Each new period brings the bills and income due in it as upcoming transactions.",
    );
  }

  if (periods.size > 0) {
    lines.push("", "By pay period:");
    for (const period of [...periods.values()].sort((a, b) => (a.startDate < b.startDate ? -1 : 1))) {
      lines.push(`- ${period.startDate} to ${period.endDate}: ${plural(period.count, "transaction")}, net ${money(period.netCents)}`);
    }
  }

  const currents = results.flatMap((result) => (result.current ? [result.current] : []));
  if (currents.length > 0) {
    // Each dry-run piece starts from the same figures, so their separate effects add up.
    const before = currents[0]!;
    const change = (figure: "leftover" | "projected") =>
      currents.reduce((sum, current) => sum + current[`${figure}AfterCents`] - current[`${figure}BeforeCents`], 0);
    lines.push(
      "",
      "Today's pay period:",
      `- Leftover so far: ${money(before.leftoverBeforeCents)} → ${money(before.leftoverBeforeCents + change("leftover"))}`,
      `- Projected leftover: ${money(before.projectedBeforeCents)} → ${money(before.projectedBeforeCents + change("projected"))}`,
    );
  }

  if (toward.size > 0) {
    lines.push("", `Upcoming entries ${saved ? "paid" : "that would be paid"} toward:`);
    for (const { name, previousCents, paidCents } of toward.values()) {
      const remaining = Math.sign(previousCents) * Math.max(0, Math.abs(previousCents) - paidCents);
      lines.push(`- ${towardLine(name, previousCents, remaining)}`);
    }
  }

  if (suggestions.length > 0) {
    lines.push(
      "",
      `${plural(suggestions.length, "row looks", "rows look")} like ${suggestions.length === 1 ? "it belongs" : "they belong"} to a bill or income` +
        (saved
          ? ". They were imported untied; update_transaction can tie them."
          : ". Nothing is tied unless the row says so: for each one that is right, add what is shown to the row."),
      listed(suggestions.map((suggestion) => suggestionLine(suggestion, rows[suggestion.index]))),
    );
  }

  if (duplicates.length > 0) {
    lines.push(
      "",
      `${plural(duplicates.length, "row")} may repeat a transaction the budget already holds (same amount, within ${DUPLICATE_WINDOW_DAYS} days). ` +
        (saved
          ? "They were imported anyway. For each that is the same payment, delete one of the two."
          : "They would be imported anyway. For each that is the same payment, take the row out of the file " +
            "(and update the existing transaction if its date or amount is off). Ask the owner about any that are unclear."),
      listed(duplicates.map((duplicate) => duplicateLine(duplicate, rows[duplicate.index]))),
    );
  }

  if (!saved) lines.push("", "To import, call import_transactions again with dryRun: false.");
  return lines.join("\n");
}

const SUGGESTION_REASONS: Record<BillOrIncomeSuggestion["reason"], string> = {
  occurrence: "it matches the upcoming entry that item added",
  same_description: "an earlier transaction tied to that item has the same description",
  name: "the item's name appears in it",
};

function suggestionLine({ index, billIncomeId, billIncomeName, reason, countsToward }: BillOrIncomeSuggestion, row: ImportRow | undefined): string {
  const incoming = row ? `${dateOf(row.occursAt)} "${row.name}" ` : "";
  // Paying toward an entry ties the row to its item as well, so that one field is enough.
  const add = countsToward ? `"countsToward": "${countsToward}"` : `"billIncomeId": "${billIncomeId}"`;
  return `row ${index} ${incoming}→ ${billIncomeName}: ${SUGGESTION_REASONS[reason]}. Add ${add}`;
}

const REASONS: Record<PossibleDuplicate["reason"], string> = {
  generated: "generated from a bill or income",
  manual: "entered by hand",
  imported: "imported earlier under a different key",
};

function duplicateLine({ index, existing, reason, daysApart }: PossibleDuplicate, row: ImportRow | undefined): string {
  const incoming = row ? `${dateOf(row.occursAt)} "${row.name}"` : "";
  const apart = daysApart === 0 ? "same day" : `${plural(daysApart, "day")} apart`;
  return (
    `row ${index} ${incoming} ↔ existing ${dateOf(existing.occursAt)} "${existing.name}" ${money(existing.amountCents)}, ` +
    `${existing.status}, ${REASONS[reason]}, ${apart}, id ${existing.id}`
  );
}
