import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LocateResponse, PeriodDatesResponse, PeriodListResponse, PeriodView } from "../../../shared/budget.ts";
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

/** Every period that exists, oldest first. Fetched only while something needs it. */
export function usePeriodList(enabled: boolean) {
  return useQuery({
    // Under the `period` prefix, so anything that adds or moves a period refreshes it too.
    queryKey: [...periodKeys.all, "list"] as const,
    queryFn: async () => (await api.get<PeriodListResponse>("/api/periods")).periods,
    enabled,
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

/** Adds the period before the earliest one. */
export function useAddEarlierPeriod() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<LocateResponse>("/api/periods/earlier"),
    // The period that was first now has a "previous" link.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: periodKeys.all }),
  });
}

type DateChange = { startDate: LocalDate; endDate: LocalDate };

/** What moving a period's dates would do, without doing it. Pass null when there is nothing to check. */
export function usePeriodDatesPreview(periodId: string, change: DateChange | null) {
  return useQuery({
    queryKey: ["period-dates-preview", periodId, change],
    queryFn: () => api.patch<PeriodDatesResponse>(`/api/periods/${periodId}/dates`, { ...change, preview: true }),
    enabled: change !== null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

// Each of these can change the starting amount, dates or transactions of several periods,
// so they all refresh every cached period.
function useRefreshPeriods() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: periodKeys.all });
}

export function useChangePeriodDates() {
  return useMutation({
    mutationFn: ({ periodId, ...change }: DateChange & { periodId: string }) =>
      api.patch<PeriodDatesResponse>(`/api/periods/${periodId}/dates`, change),
    onSuccess: useRefreshPeriods(),
  });
}

export function useSetStartingAmount() {
  return useMutation({
    mutationFn: ({ periodId, ...body }: { periodId: string; startingCents: number; carryForward: boolean }) =>
      api.patch<PeriodView>(`/api/periods/${periodId}/starting`, body),
    onSuccess: useRefreshPeriods(),
  });
}

/** Back to the calculated starting amount. */
export function useRevertStartingAmount() {
  return useMutation({
    mutationFn: (periodId: string) => api.post<PeriodView>(`/api/periods/${periodId}/starting/revert`),
    onSuccess: useRefreshPeriods(),
  });
}

/** Brings a "may be out of date" starting amount, and the run it belongs to, up to date. */
export function useRecalculateStartingAmount() {
  return useMutation({
    mutationFn: (periodId: string) => api.post<PeriodView>(`/api/periods/${periodId}/recalculate`),
    onSuccess: useRefreshPeriods(),
  });
}

/** Gives a period a limit for a category, or changes the one it has. This period only. */
export function useSetPeriodLimit() {
  return useMutation({
    mutationFn: ({ periodId, categoryId, limitCents }: { periodId: string; categoryId: string; limitCents: number }) =>
      api.put<PeriodView>(`/api/periods/${periodId}/limits/${categoryId}`, { limitCents }),
    onSuccess: useRefreshPeriods(),
  });
}

export function useRemovePeriodLimit() {
  return useMutation({
    mutationFn: ({ periodId, categoryId }: { periodId: string; categoryId: string }) =>
      api.delete<PeriodView>(`/api/periods/${periodId}/limits/${categoryId}`),
    onSuccess: useRefreshPeriods(),
  });
}
