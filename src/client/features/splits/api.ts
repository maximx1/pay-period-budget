import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AddWaitingResponse,
  SplitAddInput,
  SplitChangeResponse,
  SplitSkipInput,
  WaitingSplitsResponse,
} from "../../../shared/split.ts";
import { api } from "../../lib/api.ts";
import { billsIncomeKeys } from "../billsIncome/api.ts";
import { periodKeys } from "../periods/api.ts";

export const SPLITS_QUERY_KEY = ["splits"] as const;

/**
 * Every split with something still to pay: its unpaid payments, and what waits for pay
 * periods too far ahead to exist yet. A server older than phase 31 lists only splits with
 * payments waiting, and none of the rest.
 */
export function useWaitingSplits() {
  return useQuery({
    queryKey: SPLITS_QUERY_KEY,
    queryFn: async () => (await api.get<WaitingSplitsResponse>("/api/splits")).splits,
  });
}

/** After a split's payments changed: the splits, every period, and the bills and income they may be tied to. */
function useRefreshAfterSplitChange() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: SPLITS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: periodKeys.all }),
      queryClient.invalidateQueries({ queryKey: billsIncomeKeys.transactions }),
    ]);
}

/** Adds a split's waiting payments that are in reach now; they become ordinary transactions. */
export function useAddWaitingSplit() {
  return useMutation({
    mutationFn: (splitId: string) => api.post<AddWaitingResponse>(`/api/splits/${splitId}/add`),
    onSuccess: useRefreshAfterSplitChange(),
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

type AddToSplit = { splitId: string; input: Omit<SplitAddInput, "dryRun"> };

/** Adds more to a split; its unpaid payments from the new items' first one on are worked out again. */
export function useAddToSplit() {
  return useMutation({
    mutationFn: ({ splitId, input }: AddToSplit) => api.post<SplitChangeResponse>(`/api/splits/${splitId}/items`, input),
    onSuccess: useRefreshAfterSplitChange(),
  });
}

/** What adding to a split would make its payments, without changing them. Pass null when there is nothing to work out. */
export function useAddToSplitPreview(request: AddToSplit | null) {
  return useQuery({
    queryKey: ["split-add-preview", request],
    queryFn: () => api.post<SplitChangeResponse>(`/api/splits/${request!.splitId}/items`, { ...request!.input, dryRun: true }),
    enabled: request !== null,
    // The last plan stays on screen while the next is worked out.
    placeholderData: keepPreviousData,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

type SkipPayment = { splitId: string; input: Omit<SplitSkipInput, "dryRun"> };

/** Leaves one unpaid payment of a split out; what it held is spread over the ones after it. */
export function useSkipSplitPayment() {
  return useMutation({
    mutationFn: ({ splitId, input }: SkipPayment) => api.post<SplitChangeResponse>(`/api/splits/${splitId}/skip`, input),
    onSuccess: useRefreshAfterSplitChange(),
  });
}

/** What skipping a payment would make the ones after it, without skipping it. */
export function useSkipPreview(request: SkipPayment | null) {
  return useQuery({
    queryKey: ["split-skip-preview", request],
    queryFn: () => api.post<SplitChangeResponse>(`/api/splits/${request!.splitId}/skip`, { ...request!.input, dryRun: true }),
    enabled: request !== null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}
