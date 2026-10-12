import { useNavigate } from "react-router";
import type { PeriodView } from "../../../shared/budget.ts";
import { useToast } from "../../components/ui/Toaster.tsx";
import { ApiError } from "../../lib/api.ts";
import { useAddEarlierPeriod, useLocatePeriod } from "./api.ts";

/** Which side a period came in from, carried in the navigation so the page can slide it in. */
export type PeriodArrival = "next" | "previous";
export type PeriodNavState = { arrivedAs?: PeriodArrival };

type Move = { /** Slide the new period in, as a swipe does. */ slide?: boolean };

/**
 * Stepping from one pay period to its neighbours. Going forward opens the next period,
 * generating it first when it is within the horizon. Going back opens the one before, and
 * at the earliest period adds one, unless told to stay within the periods that exist.
 */
export function usePeriodNav({ nav }: PeriodView) {
  const navigate = useNavigate();
  const locate = useLocatePeriod();
  const addEarlier = useAddEarlierPeriod();
  const toast = useToast();

  const open = (periodId: string, arrivedAs: PeriodArrival, { slide }: Move) =>
    navigate(`/periods/${periodId}`, slide ? { state: { arrivedAs } satisfies PeriodNavState } : undefined);

  const atHorizon = !nav.nextId && !nav.nextDate;
  const busy = locate.isPending || addEarlier.isPending;

  return {
    atHorizon,
    /** A move is on its way to the server. */
    busy,
    canGoPrevious: Boolean(nav.prevId) || nav.canAddPrevious,

    async goNext(move: Move = {}) {
      if (busy) return;
      if (nav.nextId) return open(nav.nextId, "next", move);
      if (!nav.nextDate) return;
      try {
        const { periodId } = await locate.mutateAsync(nav.nextDate);
        await open(periodId, "next", move);
      } catch (error) {
        toast(error instanceof ApiError ? error.message : "Couldn't open the next period.", { variant: "error" });
      }
    },

    /**
     * `existingOnly` stops at the earliest period instead of adding the one before it:
     * that writes to the budget's history, which a swipe should never do by accident.
     */
    async goPrevious(move: Move & { existingOnly?: boolean } = {}) {
      if (busy) return;
      if (nav.prevId) return open(nav.prevId, "previous", move);
      if (!nav.canAddPrevious || move.existingOnly) return;
      try {
        const { periodId } = await addEarlier.mutateAsync();
        await open(periodId, "previous", move);
      } catch (error) {
        toast(error instanceof ApiError ? error.message : "Couldn't add the period before this one.", { variant: "error" });
      }
    },
  };
}
