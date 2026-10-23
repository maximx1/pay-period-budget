import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BalanceCheckInput,
  BalanceHistoryResponse,
  BalancePartPatch,
  BalanceSettings,
  BalancesOverTimeResponse,
  BalancesResponse,
  TrackBalanceInput,
  TrackedBalancePatch,
  TrackedBalanceResponse,
} from "../../../shared/balances.ts";
import { api } from "../../lib/api.ts";
import { billsIncomeKeys } from "../billsIncome/api.ts";

/**
 * Under the prefix every change to a transaction already refreshes: marking a payment paid
 * moves an estimate. Changes here refresh it too, since an item's totals show its balance.
 */
export const balanceKeys = {
  all: [...billsIncomeKeys.transactions, "balances"] as const,
  one: (billIncomeId: string) => [...billsIncomeKeys.transactions, "balances", billIncomeId] as const,
};

/** Opens a balance's history on the Balances page: `?item=<id>`; or starts tracking one: `?track=<id>`. */
export const balancePath = (billIncomeId: string, tracked: boolean) =>
  `/balances?${tracked ? "item" : "track"}=${encodeURIComponent(billIncomeId)}`;

/** Every tracked balance, what to ask about today, and the settings. */
export function useBalances() {
  return useQuery({ queryKey: balanceKeys.all, queryFn: () => api.get<BalancesResponse>("/api/balances") });
}

/** Owed and held across every tracked balance at the end of each pay period. */
export function useBalancesOverTime() {
  return useQuery({
    // Beside `all`, not under it: under the transactions prefix, so a payment marked paid refreshes it.
    queryKey: [...billsIncomeKeys.transactions, "balances-over-time"] as const,
    queryFn: () => api.get<BalancesOverTimeResponse>("/api/balances/over-time"),
  });
}

/** One balance with its checks and what has been paid since the last. Pass null for none. */
export function useBalanceHistory(billIncomeId: string | null) {
  return useQuery({
    queryKey: balanceKeys.one(billIncomeId ?? ""),
    queryFn: () => api.get<BalanceHistoryResponse>(`/api/balances/${billIncomeId}`),
    enabled: billIncomeId !== null,
  });
}

function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: billsIncomeKeys.transactions });
}

const path = (billIncomeId: string, rest = "") => `/api/balances/${encodeURIComponent(billIncomeId)}${rest}`;

export function useTrackBalance() {
  return useMutation({
    mutationFn: ({ billIncomeId, input }: { billIncomeId: string; input: TrackBalanceInput }) =>
      api.post<TrackedBalanceResponse>(path(billIncomeId), input),
    onSuccess: useRefresh(),
  });
}

export function useCheckBalance() {
  return useMutation({
    mutationFn: ({ billIncomeId, input }: { billIncomeId: string; input: BalanceCheckInput }) =>
      api.post<TrackedBalanceResponse>(path(billIncomeId, "/checks"), input),
    onSuccess: useRefresh(),
  });
}

export function useBalanceLooksRight() {
  return useMutation({
    mutationFn: (billIncomeId: string) => api.post<TrackedBalanceResponse>(path(billIncomeId, "/looks-right")),
    onSuccess: useRefresh(),
  });
}

export function useSnoozeBalance() {
  return useMutation({
    mutationFn: ({ billIncomeId, days }: { billIncomeId: string; days: number }) =>
      api.post<TrackedBalanceResponse>(path(billIncomeId, "/snooze"), { days }),
    onSuccess: useRefresh(),
  });
}

/** Everything asked about today waits until tomorrow. */
export function useSnoozeTodaysAsks() {
  return useMutation({ mutationFn: () => api.post<void>("/api/balances/snooze-today"), onSuccess: useRefresh() });
}

export function useUpdateTrackedBalance() {
  return useMutation({
    mutationFn: ({ billIncomeId, patch }: { billIncomeId: string; patch: TrackedBalancePatch }) =>
      api.patch<TrackedBalanceResponse>(path(billIncomeId), patch),
    onSuccess: useRefresh(),
  });
}

/** One part of the last check, renamed or given a new rate in place. */
export function useUpdateBalancePart() {
  return useMutation({
    mutationFn: ({ billIncomeId, partId, patch }: { billIncomeId: string; partId: string; patch: BalancePartPatch }) =>
      api.patch<TrackedBalanceResponse>(path(billIncomeId, `/parts/${encodeURIComponent(partId)}`), patch),
    onSuccess: useRefresh(),
  });
}

export function useStopTrackingBalance() {
  return useMutation({ mutationFn: (billIncomeId: string) => api.delete<void>(path(billIncomeId)), onSuccess: useRefresh() });
}

export function useDeleteBalanceCheck() {
  return useMutation({
    mutationFn: ({ billIncomeId, checkId }: { billIncomeId: string; checkId: string }) =>
      api.delete<TrackedBalanceResponse>(path(billIncomeId, `/checks/${encodeURIComponent(checkId)}`)),
    onSuccess: useRefresh(),
  });
}

export function useSetBalanceSettings() {
  return useMutation({
    mutationFn: (settings: BalanceSettings) => api.put<{ settings: BalanceSettings }>("/api/balances/settings", settings),
    onSuccess: useRefresh(),
  });
}
