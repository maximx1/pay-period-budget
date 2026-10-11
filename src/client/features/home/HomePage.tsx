import { CalendarClock, CalendarX, CircleCheck, Plus } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { dateOf, formatDay, isLocalDate, todayIn } from "../../../shared/dates.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Fab } from "../../components/ui/Fab.tsx";
import { PageHeader } from "../../components/ui/PageHeader.tsx";
import { ApiError } from "../../lib/api.ts";
import { useBudget } from "../budget/api.ts";
import { usePeriodView } from "../periods/api.ts";
import { GoToDateDialog } from "../periods/GoToDateDialog.tsx";
import { PeriodHeader } from "../periods/PeriodHeader.tsx";
import { PeriodSettingsDialog } from "../periods/PeriodSettingsDialog.tsx";
import { PeriodSummary } from "../periods/PeriodSummary.tsx";
import type { Transaction } from "../../../shared/transactions.ts";
import { useReorderTransactions, useSetTransactionStatus } from "../transactions/api.ts";
import { mergeOrder } from "../transactions/optimistic.ts";
import { TransactionDialog } from "../transactions/TransactionDialog.tsx";
import { TransactionSection } from "../transactions/TransactionSection.tsx";

const block = "animate-pulse rounded-2xl bg-surface-2";

/** Stands in for the header and summary while a period loads, at about their real heights. */
function PeriodSkeleton() {
  return (
    <div role="status" aria-label="Loading period">
      <div className={`${block} mb-4 h-12 w-full sm:w-80`} />
      <div className={`${block} mb-4 h-44 lg:h-28`} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className={`${block} h-56`} />
        <div className={`${block} h-56`} />
      </div>
    </div>
  );
}

/** One pay period: today's at "/", or a specific one at "/periods/:periodId". */
export function HomePage() {
  const { periodId } = useParams();
  const period = usePeriodView(periodId);
  const budget = useBudget();
  const setStatus = useSetTransactionStatus();
  const reorderTransactions = useReorderTransactions();
  // `transaction` is kept after closing so the dialog doesn't change its title while it fades out.
  const [dialog, setDialog] = useState<{ open: boolean; transaction?: Transaction }>({ open: false });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const timezone = budget.data?.timezone ?? "UTC";

  // `?date=` is how the date search says which day the user was looking for.
  const [searchParams] = useSearchParams();
  const dateParam = searchParams.get("date");
  const shown = period.data?.period;
  const soughtDay =
    dateParam && isLocalDate(dateParam) && shown && shown.startDate <= dateParam && dateParam <= shown.endDate
      ? dateParam
      : null;
  const shownId = shown?.id;
  useEffect(() => {
    if (!soughtDay || !shownId) return;
    // A frame later, so it lands after the shell has scrolled the new screen to the top.
    const frame = requestAnimationFrame(() =>
      document.querySelector(`[data-day="${soughtDay}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [soughtDay, shownId]);

  let content: ReactNode;
  if (period.isPending) {
    content = <PeriodSkeleton />;
  } else if (period.isError) {
    const notFound = period.error instanceof ApiError && period.error.code === "not_found";
    content = notFound ? (
      <Card>
        <EmptyState
          icon={CalendarX}
          title="That period doesn't exist"
          action={
            <Link to="/" className="text-sm font-semibold text-primary hover:underline">
              Go to the current period
            </Link>
          }
        />
      </Card>
    ) : (
      <div className="flex flex-col items-start gap-3">
        <Alert>Couldn't load this period.</Alert>
        <Button variant="secondary" onClick={() => period.refetch()}>
          Try again
        </Button>
      </div>
    );
  } else {
    // "Today" is the budget's today, not the device's (they differ when travelling).
    const view = period.data;
    const today = todayIn(timezone, new Date());
    const toggle = (transaction: Transaction) =>
      setStatus.mutate({ id: transaction.id, status: transaction.status === "paid" ? "upcoming" : "paid" });

    // A section reorders only its own rows; the other section's rows at the same moment keep their places.
    const reorder = (occursAt: string, sectionOrder: string[]) => {
      const group = view.transactions.filter((transaction) => transaction.occursAt === occursAt).map((transaction) => transaction.id);
      reorderTransactions.mutate(mergeOrder(group, sectionOrder));
    };

    content = (
      <>
        <PeriodHeader
          view={view}
          today={today}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenSearch={() => setSearchOpen(true)}
        />
        {soughtDay && !view.transactions.some((transaction) => dateOf(transaction.occursAt) === soughtDay) && (
          <p role="status" className="mb-4 text-sm text-muted">
            Nothing on {formatDay(soughtDay)}.
          </p>
        )}
        <PeriodSummary view={view} />
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          <TransactionSection
            title="Upcoming"
            transactions={view.transactions.filter((transaction) => transaction.status === "upcoming")}
            totalCents={view.totals.upcomingCents}
            empty={{
              icon: CalendarClock,
              title: "Nothing upcoming",
              description: "Add a transaction with the + button.",
            }}
            onToggle={toggle}
            onReorder={reorder}
            onEdit={(transaction) => setDialog({ open: true, transaction })}
            highlightDay={soughtDay}
          />
          <TransactionSection
            title="Paid"
            transactions={view.transactions.filter((transaction) => transaction.status === "paid")}
            totalCents={view.totals.paidCents}
            empty={{ icon: CircleCheck, title: "Nothing paid yet", description: "Items you mark as paid move here." }}
            onToggle={toggle}
            onReorder={reorder}
            onEdit={(transaction) => setDialog({ open: true, transaction })}
            highlightDay={soughtDay}
          />
        </div>

        <PeriodSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} view={view} />
        <GoToDateDialog open={searchOpen} onClose={() => setSearchOpen(false)} view={view} today={today} />
        <TransactionDialog
          open={dialog.open}
          onClose={() => setDialog((current) => ({ ...current, open: false }))}
          view={view}
          timezone={timezone}
          transaction={dialog.transaction}
        />
        <Fab label="Add transaction" onClick={() => setDialog({ open: true })}>
          <Plus className="size-6" aria-hidden />
        </Fab>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Home" />
      {content}
    </>
  );
}
