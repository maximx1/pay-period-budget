import { Circle, CircleCheck, Search, SearchX } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { dateOf, formatLongDate, isLocalDate, type LocalDate } from "../../../shared/dates.ts";
import { formatCents } from "../../../shared/money.ts";
import { NO_CATEGORY, NOTHING_TO_SEARCH_MESSAGE, type Transaction } from "../../../shared/transactions.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Dialog } from "../../components/ui/Dialog.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { IconButton } from "../../components/ui/IconButton.tsx";
import { SelectField } from "../../components/ui/SelectField.tsx";
import { TextField } from "../../components/ui/TextField.tsx";
import { ApiError } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { periodPathFor, shownAmount } from "../billsIncome/ItemTransactions.tsx";
import { useCategories } from "../categories/api.ts";
import { usePeriodList } from "../periods/api.ts";
import { type SearchCriteria, useTransactionSearch } from "./api.ts";

/** What the search opens already looking for. Given one, it runs at once. */
export type SearchStart = { text?: string; categoryId?: string };

type SearchDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Today in the budget's time zone. */
  today: LocalDate;
  start?: SearchStart;
};

/** Search across every pay period: by words in the name or note, by category, within dates. */
export function SearchDialog({ open, onClose, today, start }: SearchDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Search transactions" size="full">
      <SearchForm onClose={onClose} today={today} start={start} />
    </Dialog>
  );
}

const count = (n: number, noun: string) => `${n.toLocaleString("en-US")} ${noun}${n === 1 ? "" : "s"}`;

function SearchForm({ onClose, today, start }: Omit<SearchDialogProps, "open">) {
  const categories = useCategories();
  const [text, setText] = useState(start?.text ?? "");
  const [categoryId, setCategoryId] = useState(start?.categoryId ?? "");
  const [limitDates, setLimitDates] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  /** What the fields ask for, or a message saying why that is not a search. */
  function read(values: { text: string; categoryId: string }): SearchCriteria | string {
    const criteria: SearchCriteria = {};
    if (values.text.trim() !== "") criteria.text = values.text.trim();
    if (values.categoryId !== "") criteria.categoryId = values.categoryId;
    if (limitDates) {
      if ((from !== "" && !isLocalDate(from)) || (to !== "" && !isLocalDate(to))) return "Enter valid dates";
      if (from !== "" && to !== "" && to < from) return "The end date is before the start date";
      if (from !== "") criteria.from = from;
      if (to !== "") criteria.to = to;
    }
    return Object.keys(criteria).length === 0 ? NOTHING_TO_SEARCH_MESSAGE : criteria;
  }

  // Arriving with something to look for, the search has already been asked for.
  const [criteria, setCriteria] = useState<SearchCriteria | null>(() => {
    const first = read({ text: start?.text ?? "", categoryId: start?.categoryId ?? "" });
    return typeof first === "string" ? null : first;
  });
  const results = useTransactionSearch(criteria);
  // Only while results are showing, to turn each one into a link to its pay period.
  const periods = usePeriodList(criteria !== null);

  function run(values: { text: string; categoryId: string }) {
    const next = read(values);
    if (typeof next === "string") setProblem(next);
    else {
      setProblem(null);
      setCriteria(next);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    run({ text, categoryId });
  }

  /** Looks for everything named like one of the results. */
  function findLike(transaction: Transaction) {
    setText(transaction.name);
    setCategoryId("");
    run({ text: transaction.name, categoryId: "" });
  }

  const categoryOptions = [
    { value: "", label: "Any category" },
    { value: NO_CATEGORY, label: "No category" },
    ...(categories.data ?? []).map((category) => ({ value: category.id, label: category.name })),
  ];
  const categoryNames = new Map(categories.data?.map((category) => [category.id, category.name]));
  const found = results.data?.pages.flatMap((page) => page.transactions) ?? [];
  const totals = results.data?.pages[0]?.totals;

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
          <TextField
            label="Name or note"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder="kroger"
            data-autofocus
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <Button type="submit" loading={results.isFetching && !results.isFetchingNextPage}>
            <Search className="size-4" aria-hidden />
            Search
          </Button>
        </div>

        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
          <SelectField
            label="Category"
            options={categoryOptions}
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          />
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-fg sm:mt-7">
            <input
              type="checkbox"
              className="size-5 shrink-0 accent-primary"
              checked={limitDates}
              onChange={(event) => setLimitDates(event.target.checked)}
            />
            Only between certain dates
          </label>
        </div>

        {limitDates && (
          <div className="grid grid-cols-2 items-start gap-3">
            <TextField label="From" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            <TextField label="To" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </div>
        )}
        {problem && <Alert>{problem}</Alert>}
      </form>

      {results.isError && (
        <Alert>{results.error instanceof ApiError ? results.error.message : "Couldn't search. Try again."}</Alert>
      )}

      {totals && (
        <div className="border-t border-border pt-3">
          {totals.count === 0 ? (
            <EmptyState icon={SearchX} title="Nothing found" description="Try fewer letters, another category or wider dates." />
          ) : (
            <>
              <p role="status" className="mb-1 text-sm text-muted">
                {count(totals.count, "transaction")}
                {totals.outCents > 0 && ` · ${formatCents(totals.outCents)} out`}
                {totals.inCents > 0 && ` · ${formatCents(totals.inCents)} in`}
              </p>
              <ul className="divide-y divide-border">
                {found.map((transaction) => {
                  const date = dateOf(transaction.occursAt);
                  const path = periodPathFor(periods.data, date, today);
                  const paid = transaction.status === "paid";
                  const category = transaction.categoryId ? categoryNames.get(transaction.categoryId) : undefined;
                  const filed = [category, transaction.note].filter(Boolean).join(" · ");
                  const row = (
                    <>
                      {paid ? (
                        <CircleCheck className="size-5 shrink-0 text-primary" aria-hidden />
                      ) : (
                        <Circle className="size-5 shrink-0 text-muted" aria-hidden />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-fg">{transaction.name}</span>
                        <span className="block truncate text-sm text-muted">
                          {formatLongDate(date)} · {paid ? "Paid" : "Upcoming"}
                        </span>
                        {filed && <span className="block truncate text-sm text-muted">{filed}</span>}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 font-semibold tabular-nums",
                          transaction.amountCents > 0 ? "text-primary" : "text-fg",
                        )}
                      >
                        {shownAmount(transaction.amountCents)}
                      </span>
                    </>
                  );
                  const rowClass = "flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2";
                  return (
                    <li key={transaction.id} className="flex items-center gap-1">
                      {path ? (
                        <Link
                          to={path}
                          onClick={onClose}
                          aria-label={`${transaction.name}, ${formatLongDate(date)}: open its pay period`}
                          className={cn(
                            rowClass,
                            "transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                          )}
                        >
                          {row}
                        </Link>
                      ) : (
                        <div className={rowClass}>{row}</div>
                      )}
                      <IconButton label={`Find others like ${transaction.name}`} onClick={() => findLike(transaction)}>
                        <Search className="size-4" aria-hidden />
                      </IconButton>
                    </li>
                  );
                })}
              </ul>
              {results.hasNextPage && (
                <div className="mt-3 flex justify-center">
                  <Button variant="secondary" onClick={() => results.fetchNextPage()} loading={results.isFetchingNextPage}>
                    Show more
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
