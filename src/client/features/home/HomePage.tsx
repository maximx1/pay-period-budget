import { CalendarClock, CalendarX, CircleCheck, Plus, Search, SearchX } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router";
import type { PeriodView } from "../../../shared/budget.ts";
import { overLimitMessage } from "../../../shared/categories.ts";
import { dueNoticeMessage } from "../../../shared/dueDates.ts";
import { atStartOfDay, dateOf, formatDay, isLocalDate, type LocalDate, todayIn } from "../../../shared/dates.ts";
import { centsToInput } from "../../../shared/money.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Fab } from "../../components/ui/Fab.tsx";
import { IconButton } from "../../components/ui/IconButton.tsx";
import { PageHeader } from "../../components/ui/PageHeader.tsx";
import { ApiError } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { APP_NAME } from "../../lib/useDocumentTitle.ts";
import { useSwipe } from "../../lib/useSwipe.ts";
import { useBillsIncome } from "../billsIncome/api.ts";
import { useBudget } from "../budget/api.ts";
import { useCategories } from "../categories/api.ts";
import { useBalanceOutlook, usePeriodView } from "../periods/api.ts";
import { GoToDateDialog } from "../periods/GoToDateDialog.tsx";
import { OutlookWarnings } from "../periods/OutlookWarnings.tsx";
import { PeriodHeader } from "../periods/PeriodHeader.tsx";
import { PeriodSettingsDialog } from "../periods/PeriodSettingsDialog.tsx";
import { PeriodSummary } from "../periods/PeriodSummary.tsx";
import { ScanImportDialog } from "../scan/ScanImportDialog.tsx";
import { SearchDialog, type SearchStart } from "../search/SearchDialog.tsx";
import { TopBarAction } from "../shell/TopBar.tsx";
import { type PeriodNavState, usePeriodNav } from "../periods/usePeriodNav.ts";
import type { Transaction } from "../../../shared/transactions.ts";
import { useReorderTransactions, useSetTransactionStatus } from "../transactions/api.ts";
import { mergeOrder } from "../transactions/optimistic.ts";
import { PeriodFilterBar } from "../transactions/PeriodFilterBar.tsx";
import { isFiltering, matchesPeriodFilter, NO_FILTER, type PeriodFilter } from "../transactions/periodFilter.ts";
import { TransactionDialog, type TransactionPrefill } from "../transactions/TransactionDialog.tsx";
import { TransactionSection } from "../transactions/TransactionSection.tsx";
import { WaitingSplitsReminder } from "../splits/WaitingSplitsReminder.tsx";
import { BalanceAsksCard } from "../balances/BalanceAsksCard.tsx";

const block = "animate-pulse rounded-2xl bg-surface-2";

type TransactionSectionEmpty = { icon: LucideIcon; title: string; description: string };

/** Stands in for the header and summary while a period loads, at about their real heights. */
function PeriodSkeleton() {
  return (
    <div role="status" aria-label="Loading period">
      <div className={`${block} mb-4 h-12 w-full sm:w-80`} />
      <div className={`${block} mb-4 h-80 lg:h-56`} />
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
    content = <LoadedPeriod view={period.data} timezone={timezone} soughtDay={soughtDay} />;
  }

  return (
    <>
      <PageHeader title={APP_NAME} />
      {content}
    </>
  );
}

type LoadedPeriodProps = {
  view: PeriodView;
  /** The budget's time zone, for "today". */
  timezone: string;
  /** A day in this period the user arrived looking for, if any. */
  soughtDay: LocalDate | null;
};

/** A period that has loaded: its header, summary and transactions, and the dialogs they open. */
function LoadedPeriod({ view, timezone, soughtDay }: LoadedPeriodProps) {
  const setStatus = useSetTransactionStatus();
  const reorderTransactions = useReorderTransactions();
  // `transaction` is kept after closing so the dialog doesn't change its title while it fades out.
  const [dialog, setDialog] = useState<{ open: boolean; transaction?: Transaction; prefill?: TransactionPrefill }>({
    open: false,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // `start` is what the search opens already looking for, e.g. a transaction's name.
  const [transactionSearch, setTransactionSearch] = useState<{ open: boolean; start?: SearchStart }>({ open: false });
  const openTransactionSearch = (start?: SearchStart) => setTransactionSearch({ open: true, start });
  // Narrows Upcoming and Paid. Kept when moving to another period, to look for the same thing there.
  const [filter, setFilter] = useState<PeriodFilter>(NO_FILTER);
  const categories = useCategories();
  // Screenshots picked in the add dialog's second tab, being read and reviewed.
  const [scan, setScan] = useState<{ open: boolean; files: File[] }>({ open: false, files: [] });

  // One set of moves for the arrows and for swiping, so neither starts while the other is under way.
  const periodNav = usePeriodNav(view);
  // Like turning a page: a swipe toward the left brings the next period in from the right.
  // Swiping back never adds a period before the earliest; that stays a tap on the arrow.
  const swipe = useSwipe({
    onLeft: () => periodNav.goNext({ slide: true }),
    onRight: () => periodNav.goPrevious({ slide: true, existingOnly: true }),
    enabled: !periodNav.busy,
    canLeft: !periodNav.atHorizon,
    canRight: Boolean(view.nav.prevId),
  });
  const arrivedAs = (useLocation().state as PeriodNavState | null)?.arrivedAs;

  // "Today" is the budget's today, not the device's (they differ when travelling).
  const today = todayIn(timezone, new Date());
  const toggle = (transaction: Transaction) =>
    setStatus.mutate({ id: transaction.id, status: transaction.status === "paid" ? "upcoming" : "paid" });

  // One line for each category whose limit this period has passed, or is set to pass.
  const overLimits = view.categoryLimits.flatMap((limit) => {
    const message = overLimitMessage(limit);
    return message ? [{ categoryId: limit.categoryId, message }] : [];
  });

  // And one for each day a bill is due that nothing is set to pay by then, or that is soon
  // with its payment not marked paid: red when it is soon. A server older than the app (the
  // phone carries its own copy) sends none, or none of the newer fields.
  const billsIncome = useBillsIncome();
  const dueNotices = (view.dueNotices ?? []).map((notice) => {
    const item = billsIncome.data?.find((entry) => entry.id === notice.billIncomeId);
    // With nothing set to pay it, offer to add the payment: tied to it, on the day it is due
    // (or today, once that has passed), for its usual amount, filed where it files things.
    const prefill: TransactionPrefill | null =
      item && !notice.unpaidDate && notice.lateDate === null
        ? {
            name: item.name,
            kind: "expense",
            amount: item.defaultAmountCents > 0 ? centsToInput(item.defaultAmountCents) : "",
            occursAt: atStartOfDay(notice.dueDate < today ? today : notice.dueDate),
            billIncomeId: item.id,
            categoryId: item.categoryId ?? "",
          }
        : null;
    return {
      key: `${notice.billIncomeId}:${notice.dueDate}`,
      message: dueNoticeMessage(notice, today),
      urgent: notice.urgent ?? false,
      name: notice.name,
      prefill,
    };
  });

  // The coming periods set to end low or below zero, warned about on the current period only.
  const outlook = useBalanceOutlook(view.period.isCurrent).data;
  const outlookWarns = view.period.isCurrent && Boolean(outlook?.periods.some((period) => period.level !== "ok"));

  const filtering = isFiltering(filter);
  const categoryNames = new Map(categories.data?.map((category) => [category.id, category.name]));
  /** One section's rows as shown, with what to say about them. */
  const section = (status: Transaction["status"], totalCents: number, empty: TransactionSectionEmpty) => {
    const all = view.transactions.filter((transaction) => transaction.status === status);
    if (!filtering) return { transactions: all, totalCents, empty };
    const shown = all.filter((transaction) =>
      matchesPeriodFilter(transaction, filter, transaction.categoryId ? categoryNames.get(transaction.categoryId) : undefined),
    );
    return {
      transactions: shown,
      // The total follows what is shown: "how much went to Kroger this period".
      totalCents: shown.reduce((sum, transaction) => sum + transaction.amountCents, 0),
      empty: { icon: SearchX, title: "Nothing matches", description: "Try other words, or another category." },
      totalCount: all.length,
      reorderable: false,
    };
  };

  // A section reorders only its own rows; the other section's rows at the same moment keep their places.
  const reorder = (occursAt: string, sectionOrder: string[]) => {
    const group = view.transactions.filter((transaction) => transaction.occursAt === occursAt).map((transaction) => transaction.id);
    reorderTransactions.mutate(mergeOrder(group, sectionOrder));
  };

  return (
    <>
      {/* Clips the period while it slides off the side, so the page never scrolls sideways. */}
      <div className="flex flex-1 flex-col overflow-x-clip" style={{ overflowClipMargin: 8 }}>
        {/* Fills the rest of the page column, so a swipe below a short period still counts.
            Keyed by period, so the slide plays once per arrival and not when a transaction changes. */}
        <div
          key={view.period.id}
          className={cn(
            "flex-1 touch-pan-y touch-pinch-zoom",
            arrivedAs === "next" && "period-from-next",
            arrivedAs === "previous" && "period-from-previous",
          )}
          {...swipe}
        >
          <PeriodHeader
            view={view}
            periodNav={periodNav}
            today={today}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenSearch={() => setSearchOpen(true)}
            onOpenTransactionSearch={() => openTransactionSearch()}
          />
          {soughtDay && !view.transactions.some((transaction) => dateOf(transaction.occursAt) === soughtDay) && (
            <p role="status" className="mb-4 text-sm text-muted">
              Nothing on {formatDay(soughtDay)}.
            </p>
          )}
          {(outlookWarns || overLimits.length > 0 || dueNotices.length > 0) && (
            <div className="mb-4 flex flex-col gap-2">
              {outlookWarns && outlook && <OutlookWarnings outlook={outlook} />}
              {dueNotices.map(({ key, message, urgent, name, prefill }) => (
                <Alert key={key} tone={urgent ? "danger" : "warning"}>
                  <p>{message}</p>
                  {prefill && (
                    <Button
                      variant="secondary"
                      className="mt-2"
                      aria-label={`Add a payment for ${name}`}
                      onClick={() => setDialog({ open: true, prefill })}
                    >
                      <Plus className="size-4" aria-hidden />
                      Add payment
                    </Button>
                  )}
                </Alert>
              ))}
              {overLimits.map(({ categoryId, message }) => (
                <Alert key={categoryId} tone="warning">
                  {message}
                </Alert>
              ))}
            </div>
          )}
          <WaitingSplitsReminder />
          <PeriodSummary view={view} today={today} />
          {/* Below the summary: the period's own figures come first, these are a chore. */}
          {view.period.isCurrent && <BalanceAsksCard />}
          {(view.transactions.length > 0 || filtering) && (
            <PeriodFilterBar filter={filter} onChange={setFilter} categories={categories.data ?? []} />
          )}
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
            <TransactionSection
              title="Upcoming"
              {...section("upcoming", view.totals.upcomingCents, {
                icon: CalendarClock,
                title: "Nothing upcoming",
                description: "Add a transaction with the + button.",
              })}
              onToggle={toggle}
              onReorder={reorder}
              onEdit={(transaction) => setDialog({ open: true, transaction })}
              highlightDay={soughtDay}
            />
            <TransactionSection
              title="Paid"
              {...section("paid", view.totals.paidCents, {
                icon: CircleCheck,
                title: "Nothing paid yet",
                description: "Items you mark as paid move here.",
              })}
              onToggle={toggle}
              onReorder={reorder}
              onEdit={(transaction) => setDialog({ open: true, transaction })}
              highlightDay={soughtDay}
            />
          </div>
        </div>
      </div>

      <PeriodSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} view={view} />
      <GoToDateDialog open={searchOpen} onClose={() => setSearchOpen(false)} view={view} today={today} />
      <TransactionDialog
        open={dialog.open}
        onClose={() => setDialog((current) => ({ ...current, open: false }))}
        view={view}
        timezone={timezone}
        transaction={dialog.transaction}
        prefill={dialog.prefill}
        onFindLike={(transaction) => {
          setDialog((current) => ({ ...current, open: false }));
          openTransactionSearch({ text: transaction.name });
        }}
        onScan={(files) => {
          setDialog((current) => ({ ...current, open: false }));
          setScan({ open: true, files });
        }}
      />
      <ScanImportDialog open={scan.open} files={scan.files} onClose={() => setScan((current) => ({ ...current, open: false }))} />
      <SearchDialog
        open={transactionSearch.open}
        onClose={() => setTransactionSearch((current) => ({ ...current, open: false }))}
        today={today}
        start={transactionSearch.start}
      />
      <TopBarAction>
        <IconButton label="Search transactions" aria-haspopup="dialog" onClick={() => openTransactionSearch()}>
          <Search className="size-6" aria-hidden />
        </IconButton>
      </TopBarAction>
      <Fab label="Add transaction" onClick={() => setDialog({ open: true })}>
        <Plus className="size-6" aria-hidden />
      </Fab>
    </>
  );
}
