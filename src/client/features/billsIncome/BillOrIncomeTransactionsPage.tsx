import { ArrowLeft, SearchX } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { Link, useParams } from "react-router";
import { todayIn } from "../../../shared/dates.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { PageHeader } from "../../components/ui/PageHeader.tsx";
import { useBudget } from "../budget/api.ts";
import { usePeriodList } from "../periods/api.ts";
import { useAllBillOrIncomeTransactions, useBillsIncome } from "./api.ts";
import { ItemTotals, ItemTransactionList, KIND_LABELS, shownAmount, signedUsualOf } from "./ItemTransactions.tsx";

const backLink = (
  <Link
    to="/bills-income"
    className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
  >
    <ArrowLeft className="size-4" aria-hidden />
    Bills & Income
  </Link>
);

/** Everything tied to one bill or income, newest first, loading more as the end comes into view. */
export function BillOrIncomeTransactionsPage() {
  const { billIncomeId = "" } = useParams();
  const items = useBillsIncome();
  const budget = useBudget();
  const periods = usePeriodList(true);
  const list = useAllBillOrIncomeTransactions(billIncomeId);
  const item = items.data?.find((candidate) => candidate.id === billIncomeId);
  const today = todayIn(budget.data?.timezone ?? "UTC", new Date());

  // Load the next page when the end of the list scrolls into view. The button below does
  // the same by hand, for when that cannot be noticed.
  const end = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  useEffect(() => {
    const marker = end.current;
    if (!marker || !hasNextPage || isFetchingNextPage || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void fetchNextPage();
      },
      { rootMargin: "200px" },
    );
    observer.observe(marker);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  let content: ReactNode;
  if (items.isPending || list.isPending) {
    content = <div className="h-64 animate-pulse rounded-2xl bg-surface-2" role="status" aria-label="Loading transactions" />;
  } else if (items.isSuccess && !item) {
    content = (
      <Card>
        <EmptyState icon={SearchX} title="No such bill or income" description="It may have been deleted." action={backLink} />
      </Card>
    );
  } else if (items.isError || list.isError) {
    content = (
      <div className="flex flex-col items-start gap-3">
        <Alert>Couldn't load these transactions.</Alert>
        <Button
          variant="secondary"
          onClick={() => {
            void items.refetch();
            void list.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  } else {
    const transactions = list.data.pages.flatMap((page) => page.transactions);
    // Totals come with every page; the latest page has the freshest.
    const totals = list.data.pages.at(-1)!.totals;
    content = (
      <div className="flex max-w-3xl flex-col gap-4">
        <ItemTotals totals={totals} />
        <Card padding="none" className="p-2">
          {transactions.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted">
              Nothing yet. Transactions it adds, and ones you tie to it, show up here.
            </p>
          ) : (
            <ItemTransactionList transactions={transactions} periods={periods.data} today={today} />
          )}
        </Card>
        <div ref={end} />
        {hasNextPage ? (
          <Button variant="secondary" className="self-center" loading={isFetchingNextPage} onClick={() => fetchNextPage()}>
            Load more
          </Button>
        ) : (
          transactions.length > 0 && (
            <p className="text-center text-sm text-muted">
              {transactions.length === 1 ? "That's the only one." : `That's all ${transactions.length}.`}
            </p>
          )
        )}
      </div>
    );
  }

  const subtitle = item
    ? [KIND_LABELS[item.kind], item.scheduleText, item.defaultAmountCents > 0 ? shownAmount(signedUsualOf(item)) : null]
        .filter(Boolean)
        .join(" · ")
    : undefined;

  return (
    <>
      <PageHeader title={item?.name ?? "Bills & Income"} subtitle={subtitle} actions={backLink} />
      {content}
    </>
  );
}
