import { CalendarX, ReceiptText } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { todayIn } from "../../../shared/dates.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { PageHeader } from "../../components/ui/PageHeader.tsx";
import { ApiError } from "../../lib/api.ts";
import { useBudget } from "../budget/api.ts";
import { usePeriodView } from "../periods/api.ts";
import { PeriodHeader } from "../periods/PeriodHeader.tsx";
import { PeriodSummary } from "../periods/PeriodSummary.tsx";

const block = "animate-pulse rounded-2xl bg-surface-2";

/** Stands in for the header and summary while a period loads, at about their real heights. */
function PeriodSkeleton() {
  return (
    <div role="status" aria-label="Loading period">
      <div className={`${block} mb-4 h-12 w-full sm:w-80`} />
      <div className={`${block} mb-4 h-44 lg:h-28`} />
      <div className={`${block} h-48`} />
    </div>
  );
}

/** One pay period: today's at "/", or a specific one at "/periods/:periodId". */
export function HomePage() {
  const { periodId } = useParams();
  const period = usePeriodView(periodId);
  const budget = useBudget();

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
    const today = todayIn(budget.data?.timezone ?? "UTC", new Date());
    content = (
      <>
        <PeriodHeader view={period.data} today={today} />
        <PeriodSummary view={period.data} />
        <Card>
          <EmptyState
            icon={ReceiptText}
            title="No transactions yet"
            description="Coming in phase 4: add what you spend and what you're paid."
          />
        </Card>
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
