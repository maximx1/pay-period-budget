import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PeriodView } from "../../../shared/budget.ts";
import type {
  TransactionInput,
  TransactionPatch,
  TransactionResponse,
  TransactionStatus,
} from "../../../shared/transactions.ts";
import { useToast } from "../../components/ui/Toaster.tsx";
import { api } from "../../lib/api.ts";
import { periodKeys } from "../periods/api.ts";
import { billsIncomeKeys } from "../billsIncome/api.ts";
import { withOrder, withStatus } from "./optimistic.ts";

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
      const previous = queryClient.getQueriesData<PeriodView>({ queryKey: periodKeys.all });
      const paidAt = new Date().toISOString();
      queryClient.setQueriesData<PeriodView>({ queryKey: periodKeys.all }, (view) => view && withStatus(view, id, status, paidAt));
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
      const previous = queryClient.getQueriesData<PeriodView>({ queryKey: periodKeys.all });
      queryClient.setQueriesData<PeriodView>({ queryKey: periodKeys.all }, (view) => view && withOrder(view, ids));
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
