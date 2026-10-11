import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LocateResponse, PeriodView } from "../../../shared/budget.ts";
import type { LocalDate } from "../../../shared/dates.ts";
import { ApiError, api } from "../../lib/api.ts";

export const periodKeys = {
  /** Prefix of every period query; invalidate this after anything that can change a period. */
  all: ["period"] as const,
  current: ["period", "current"] as const,
  byId: (id: string) => ["period", id] as const,
};

/** One period with its totals and navigation: the given one, or today's when `periodId` is omitted. */
export function usePeriodView(periodId: string | undefined) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: periodId ? periodKeys.byId(periodId) : periodKeys.current,
    queryFn: async () => {
      const view = await api.get<PeriodView>(periodId ? `/api/periods/${periodId}` : "/api/periods/current");
      // The same period will be asked for by id as soon as the user steps away and back.
      if (!periodId) queryClient.setQueryData(periodKeys.byId(view.period.id), view);
      return view;
    },
    // A 4xx (unknown period, no budget) won't improve on retry.
    retry: (failures, error) => failures < 1 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
  });
}

/** Finds the period containing a date, creating periods up to it when allowed. */
export function useLocatePeriod() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (date: LocalDate) => api.post<LocateResponse>("/api/periods/locate", { date }),
    // New periods may now exist, which changes the "next" link of the one before them.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: periodKeys.all }),
  });
}
