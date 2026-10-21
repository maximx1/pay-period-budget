import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TransactionSplitInput, TransactionSplitResponse } from "../../../shared/split.ts";
import type {
  TransactionImportInput,
  TransactionImportResponse,
  TransactionInput,
  TransactionPatch,
  TransactionResponse,
  TransactionStatus,
} from "../../../shared/transactions.ts";
import { useToast } from "../../components/ui/Toaster.tsx";
import { api } from "../../lib/api.ts";
import { periodKeys } from "../periods/api.ts";
import { billsIncomeKeys } from "../billsIncome/api.ts";
import { SPLITS_QUERY_KEY } from "../splits/api.ts";
import { isPeriodView, withOrder, withStatus } from "./optimistic.ts";

// A transaction changes its own period's totals and the starting amount of every period
// after it, so each of these refreshes all cached periods rather than just one. It may
// also be tied to a bill or income, whose own list of transactions is refreshed too.

function useRefreshAfterChange() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: periodKeys.all }),
      queryClient.invalidateQueries({ queryKey: billsIncomeKeys.transactions }),
    ]);
}

export function useCreateTransaction() {
  return useMutation({
    mutationFn: (input: TransactionInput) => api.post<TransactionResponse>("/api/transactions", input),
    onSuccess: useRefreshAfterChange(),
  });
}

/**
 * Many transactions at once. With `dryRun` it only reports what would happen (possible
 * duplicates, the bill or income each probably belongs to) and refreshes nothing.
 */
export function useImportTransactions() {
  const refresh = useRefreshAfterChange();
  return useMutation({
    mutationFn: (input: TransactionImportInput) => api.post<TransactionImportResponse>("/api/transactions/import", input),
    onSuccess: (_result, input) => (input.dryRun ? undefined : refresh()),
  });
}

/**
 * Amounts due by dates, spread over the pay periods before them: one transaction per
 * period. What falls too far ahead waits under Split payments.
 */
export function useSplitTransaction() {
  const refresh = useRefreshAfterChange();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TransactionSplitInput) => api.post<TransactionSplitResponse>("/api/transactions/split", input),
    onSuccess: () => Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: SPLITS_QUERY_KEY })]),
  });
}

/** The transactions a split would make, without making them. Pass null when there is nothing to work out. */
export function useSplitPreview(input: Omit<TransactionSplitInput, "dryRun"> | null) {
  return useQuery({
    queryKey: ["split-preview", input],
    queryFn: () => api.post<TransactionSplitResponse>("/api/transactions/split", { ...input, dryRun: true }),
    enabled: input !== null,
    // The last plan stays on screen while the next is worked out.
    placeholderData: keepPreviousData,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

export function useUpdateTransaction() {
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TransactionPatch }) =>
      api.patch<TransactionResponse>(`/api/transactions/${id}`, patch),
    onSuccess: useRefreshAfterChange(),
  });
}

export function useDeleteTransaction() {
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/transactions/${id}`),
    onSuccess: useRefreshAfterChange(),
  });
}

const STATUS_MUTATION_KEY = ["transaction-status"] as const;

/** Marks a transaction paid or upcoming, updating the screen at once and undoing it if the save fails. */
export function useSetTransactionStatus() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationKey: STATUS_MUTATION_KEY,
    mutationFn: ({ id, status }: { id: string; status: TransactionStatus }) =>
      api.patch<TransactionResponse>(`/api/transactions/${id}`, { status }),

    onMutate: async ({ id, status }) => {
      // An in-flight refetch would overwrite the optimistic state with older data.
      await queryClient.cancelQueries({ queryKey: periodKeys.all });
      const previous = queryClient.getQueriesData({ queryKey: periodKeys.all });
      const paidAt = new Date().toISOString();
      queryClient.setQueriesData({ queryKey: periodKeys.all }, (data) =>
        isPeriodView(data) ? withStatus(data, id, status, paidAt) : data,
      );
      return { previous };
    },

    onError: (_error, _variables, context) => {
      for (const [key, view] of context?.previous ?? []) queryClient.setQueryData(key, view);
      toast("Couldn't update that. Try again.", { variant: "error" });
    },

    onSettled: () => {
      // While more taps are still saving, their optimistic state is newer than the server's.
      if (queryClient.isMutating({ mutationKey: STATUS_MUTATION_KEY }) === 1) {
        // Paid or upcoming also moves the totals shown for the bill or income it is tied to.
        void queryClient.invalidateQueries({ queryKey: billsIncomeKeys.transactions });
        return queryClient.invalidateQueries({ queryKey: periodKeys.all });
      }
    },
  });
}

const ORDER_MUTATION_KEY = ["transaction-order"] as const;

/** Saves a new order for transactions sharing one date and time, showing it at once. */
export function useReorderTransactions() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationKey: ORDER_MUTATION_KEY,
    mutationFn: (ids: string[]) => api.put<void>("/api/transactions/order", { ids }),

    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: periodKeys.all });
      const previous = queryClient.getQueriesData({ queryKey: periodKeys.all });
      queryClient.setQueriesData({ queryKey: periodKeys.all }, (data) => (isPeriodView(data) ? withOrder(data, ids) : data));
      return { previous };
    },

    onError: (_error, _ids, context) => {
      for (const [key, view] of context?.previous ?? []) queryClient.setQueryData(key, view);
      toast("Couldn't save that order. Try again.", { variant: "error" });
    },

    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: ORDER_MUTATION_KEY }) === 1) {
        return queryClient.invalidateQueries({ queryKey: periodKeys.all });
      }
    },
  });
}
