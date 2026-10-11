import { ChevronLeft, ChevronRight, Settings2 } from "lucide-react";
import { Link, useNavigate } from "react-router";
import type { PeriodView } from "../../../shared/budget.ts";
import { formatDateRange } from "../../../shared/dates.ts";
import { IconButton } from "../../components/ui/IconButton.tsx";
import { useToast } from "../../components/ui/Toaster.tsx";
import { ApiError } from "../../lib/api.ts";
import { useLocatePeriod } from "./api.ts";

function describe({ isCurrent, startDate, endDate, datesEdited }: PeriodView["period"], today: string) {
  const when = isCurrent ? "Current period" : endDate < today ? "Past period" : startDate > today ? "Upcoming period" : "";
  return datesEdited ? `${when} · dates edited` : when;
}

/** The period's date range with controls to step to its neighbours, adjust it, and return to today. */
type PeriodHeaderProps = {
  view: PeriodView;
  today: string;
  onOpenSettings: () => void;
};

export function PeriodHeader({ view, today, onOpenSettings }: PeriodHeaderProps) {
  const { period, nav } = view;
  const navigate = useNavigate();
  const locate = useLocatePeriod();
  const toast = useToast();

  const atHorizon = !nav.nextId && !nav.nextDate;

  async function goNext() {
    if (nav.nextId) return navigate(`/periods/${nav.nextId}`);
    if (!nav.nextDate) return;
    try {
      const { periodId } = await locate.mutateAsync(nav.nextDate);
      navigate(`/periods/${periodId}`);
    } catch (error) {
      toast(error instanceof ApiError ? error.message : "Couldn't open the next period.", { variant: "error" });
    }
  }

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <div className="flex w-full items-center gap-1 sm:w-auto">
        <IconButton
          label="Previous period"
          variant="secondary"
          disabled={!nav.prevId}
          onClick={() => navigate(`/periods/${nav.prevId}`)}
        >
          <ChevronLeft className="size-5" aria-hidden />
        </IconButton>
        <div className="min-w-0 flex-1 px-2 text-center sm:min-w-56">
          <h2 className="text-base font-semibold text-fg tabular-nums sm:text-lg">
            {formatDateRange(period.startDate, period.endDate)}
          </h2>
          <p className="text-sm text-muted">{describe(period, today)}</p>
        </div>
        <IconButton
          label={atHorizon ? "That's as far ahead as the budget goes" : "Next period"}
          variant="secondary"
          disabled={atHorizon || locate.isPending}
          onClick={goNext}
        >
          <ChevronRight className="size-5" aria-hidden />
        </IconButton>
        <IconButton label="Period settings" aria-haspopup="dialog" onClick={onOpenSettings}>
          <Settings2 className="size-5" aria-hidden />
        </IconButton>
      </div>

      {!period.isCurrent && (
        <Link
          to="/"
          className="ml-auto inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-primary hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Today
        </Link>
      )}
    </div>
  );
}
