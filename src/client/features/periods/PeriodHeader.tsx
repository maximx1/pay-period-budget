import { CalendarSearch, ChevronLeft, ChevronRight, Settings2 } from "lucide-react";
import { Link, useNavigate } from "react-router";
import type { PeriodView } from "../../../shared/budget.ts";
import { formatDateRange } from "../../../shared/dates.ts";
import { IconButton } from "../../components/ui/IconButton.tsx";
import { useToast } from "../../components/ui/Toaster.tsx";
import { ApiError } from "../../lib/api.ts";
import { useAddEarlierPeriod, useLocatePeriod } from "./api.ts";

function describe({ isCurrent, startDate, endDate, datesEdited, seq }: PeriodView["period"], today: string) {
  const when = isCurrent
    ? "Current period"
    : seq < 0
      ? "Before your budget started"
      : endDate < today
        ? "Past period"
        : startDate > today
          ? "Upcoming period"
          : "";
  return datesEdited ? `${when} · dates edited` : when;
}

/**
 * The period's date range with controls to step to its neighbours, adjust it, and return to
 * today. The range itself is a button that opens the date search.
 */
type PeriodHeaderProps = {
  view: PeriodView;
  today: string;
  onOpenSettings: () => void;
  onOpenSearch: () => void;
};

export function PeriodHeader({ view, today, onOpenSettings, onOpenSearch }: PeriodHeaderProps) {
  const { period, nav } = view;
  const navigate = useNavigate();
  const locate = useLocatePeriod();
  const addEarlier = useAddEarlierPeriod();
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

  // At the earliest period the arrow adds the one before it, as the other arrow adds the next.
  async function goPrevious() {
    if (nav.prevId) return navigate(`/periods/${nav.prevId}`);
    if (!nav.canAddPrevious) return;
    try {
      const { periodId } = await addEarlier.mutateAsync();
      navigate(`/periods/${periodId}`);
    } catch (error) {
      toast(error instanceof ApiError ? error.message : "Couldn't add the period before this one.", { variant: "error" });
    }
  }

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <div className="flex w-full items-center gap-1 sm:w-auto">
        <IconButton
          label={
            nav.prevId
              ? "Previous period"
              : nav.canAddPrevious
                ? "Add the period before this one"
                : "That's as far back as the budget goes"
          }
          variant="secondary"
          disabled={(!nav.prevId && !nav.canAddPrevious) || addEarlier.isPending}
          onClick={goPrevious}
        >
          <ChevronLeft className="size-5" aria-hidden />
        </IconButton>
        <h2 className="min-w-0 flex-1 sm:min-w-56">
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={onOpenSearch}
            className="min-h-11 w-full rounded-lg px-1 text-center hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:px-2"
          >
            {/* A phone has no room for the icon beside the dates, so there the dotted underline says "tap me". */}
            <span className="flex items-center justify-center gap-1.5 text-base font-semibold whitespace-nowrap text-fg tabular-nums underline decoration-border decoration-dotted underline-offset-4 sm:text-lg sm:no-underline">
              {formatDateRange(period.startDate, period.endDate)}
              <CalendarSearch className="hidden size-4 shrink-0 text-muted sm:block" aria-hidden />
            </span>
            <span className="block text-sm font-normal text-muted">{describe(period, today)}</span>
            <span className="sr-only">. Go to a date</span>
          </button>
        </h2>
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
