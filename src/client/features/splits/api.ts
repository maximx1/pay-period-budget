import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AddWaitingResponse, WaitingSplitsResponse } from "../../../shared/split.ts";
import { api } from "../../lib/api.ts";
import { billsIncomeKeys } from "../billsIncome/api.ts";
import { periodKeys } from "../periods/api.ts";

export const SPLITS_QUERY_KEY = ["splits"] as const;

/** What splits have waiting for pay periods too far ahead to exist yet. */
export function useWaitingSplits() {
  return useQuery({
    queryKey: SPLITS_QUERY_KEY,
    queryFn: async () => (await api.get<WaitingSplitsResponse>("/api/splits")).splits,
  });
}

/** Adds a split's waiting payments that are in reach now; they become ordinary transactions. */
export function useAddWaitingSplit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (splitId: string) => api.post<AddWaitingResponse>(`/api/splits/${splitId}/add`),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: SPLITS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: periodKeys.all }),
        queryClient.invalidateQueries({ queryKey: billsIncomeKeys.transactions }),
      ]),
  });
}

/** Drops what a split still has waiting. What was already added stays. */
export function useCancelWaitingSplit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (splitId: string) => api.delete<void>(`/api/splits/${splitId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SPLITS_QUERY_KEY }),
  });
}
