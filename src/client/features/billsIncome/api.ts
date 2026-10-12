import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BillOrIncomeInput,
  BillsIncomeListResponse,
  BillOrIncomePatch,
  BillOrIncomePreview,
  BillOrIncomeResponse,
  BillOrIncomeTransactionsResponse,
} from "../../../shared/billsIncome.ts";
import { api } from "../../lib/api.ts";
import { periodKeys } from "../periods/api.ts";

export const billsIncomeKeys = {
  all: ["bills-income"] as const,
  list: ["bills-income", "list"] as const,
  preview: (input: BillOrIncomeInput) => ["bills-income", "preview", input] as const,
  /** Prefix of every "what is tied to this item" query; invalidate it when any transaction changes. */
  transactions: ["bills-income", "transactions"] as const,
};

/** How many of an item's transactions the detail dialog shows before "all transactions". */
export const RECENT_TRANSACTIONS = 10;
/** How many more the full list loads at a time. */
export const TRANSACTIONS_PAGE = 30;

const transactionsPath = (id: string, limit: number, before?: string | null) =>
  `/api/bills-income/${id}/transactions?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ""}`;

/** The newest few transactions tied to an item, with totals over all of them. Pass null for none. */
export function useRecentBillOrIncomeTransactions(id: string | null) {
  return useQuery({
    queryKey: [...billsIncomeKeys.transactions, id, "recent"] as const,
    queryFn: () => api.get<BillOrIncomeTransactionsResponse>(transactionsPath(id ?? "", RECENT_TRANSACTIONS)),
    enabled: id !== null,
  });
}

/** Everything tied to an item, newest first, a page at a time. */
export function useAllBillOrIncomeTransactions(id: string) {
  return useInfiniteQuery({
    queryKey: [...billsIncomeKeys.transactions, id, "all"] as const,
    queryFn: ({ pageParam }) =>
      api.get<BillOrIncomeTransactionsResponse>(transactionsPath(id, TRANSACTIONS_PAGE, pageParam)),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

export function useBillsIncome() {
  return useQuery({
    queryKey: billsIncomeKeys.list,
    queryFn: async () => (await api.get<BillsIncomeListResponse>("/api/bills-income")).items,
  });
}

/** What saving this new item would add to existing periods. Pass null while the form is incomplete. */
export function useBillOrIncomePreview(input: BillOrIncomeInput | null) {
  return useQuery({
    queryKey: input ? billsIncomeKeys.preview(input) : ["bills-income", "preview", "none"],
    queryFn: () => api.post<BillOrIncomePreview>("/api/bills-income/preview", input),
    enabled: input !== null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/** Refreshes the list, and the periods too when their transactions may have changed. */
function useRefresh(options: { periods: boolean }) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: billsIncomeKeys.list }),
      options.periods ? queryClient.invalidateQueries({ queryKey: periodKeys.all }) : null,
      options.periods ? queryClient.invalidateQueries({ queryKey: billsIncomeKeys.transactions }) : null,
    ]);
}

export function useCreateBillOrIncome() {
  return useMutation({
    mutationFn: (input: BillOrIncomeInput) => api.post<BillOrIncomeResponse>("/api/bills-income", input),
    onSuccess: useRefresh({ periods: true }),
  });
}

export function useUpdateBillOrIncome() {
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: BillOrIncomePatch }) =>
      api.patch<BillOrIncomeResponse>(`/api/bills-income/${id}`, patch),
    // Editing the template never changes existing transactions, so periods stay as they are.
    onSuccess: useRefresh({ periods: false }),
  });
}

export function useDeleteBillOrIncome() {
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/bills-income/${id}`),
    onSuccess: useRefresh({ periods: true }),
  });
}

export function useEndBillOrIncome() {
  return useMutation({
    mutationFn: ({ id, removeUpcoming }: { id: string; removeUpcoming: boolean }) =>
      api.post<BillOrIncomeResponse>(`/api/bills-income/${id}/end`, { removeUpcoming }),
    onSuccess: useRefresh({ periods: true }),
  });
}
