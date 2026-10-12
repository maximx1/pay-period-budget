import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  RecurringInput,
  RecurringListResponse,
  RecurringPatch,
  RecurringPreview,
  RecurringResponse,
  RecurringTransactionsResponse,
} from "../../../shared/recurring.ts";
import { api } from "../../lib/api.ts";
import { periodKeys } from "../periods/api.ts";

export const recurringKeys = {
  all: ["recurring"] as const,
  list: ["recurring", "list"] as const,
  preview: (input: RecurringInput) => ["recurring", "preview", input] as const,
  /** Prefix of every "what is tied to this item" query; invalidate it when any transaction changes. */
  transactions: ["recurring", "transactions"] as const,
};

/** How many of an item's transactions the detail dialog shows before "all transactions". */
export const RECENT_TRANSACTIONS = 10;
/** How many more the full list loads at a time. */
export const TRANSACTIONS_PAGE = 30;

const transactionsPath = (id: string, limit: number, before?: string | null) =>
  `/api/recurring/${id}/transactions?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ""}`;

/** The newest few transactions tied to an item, with totals over all of them. Pass null for none. */
export function useRecentRecurringTransactions(id: string | null) {
  return useQuery({
    queryKey: [...recurringKeys.transactions, id, "recent"] as const,
    queryFn: () => api.get<RecurringTransactionsResponse>(transactionsPath(id ?? "", RECENT_TRANSACTIONS)),
    enabled: id !== null,
  });
}

/** Everything tied to an item, newest first, a page at a time. */
export function useAllRecurringTransactions(id: string) {
  return useInfiniteQuery({
    queryKey: [...recurringKeys.transactions, id, "all"] as const,
    queryFn: ({ pageParam }) =>
      api.get<RecurringTransactionsResponse>(transactionsPath(id, TRANSACTIONS_PAGE, pageParam)),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

export function useRecurringItems() {
  return useQuery({
    queryKey: recurringKeys.list,
    queryFn: async () => (await api.get<RecurringListResponse>("/api/recurring")).items,
  });
}

/** What saving this new item would add to existing periods. Pass null while the form is incomplete. */
export function useRecurringPreview(input: RecurringInput | null) {
  return useQuery({
    queryKey: input ? recurringKeys.preview(input) : ["recurring", "preview", "none"],
    queryFn: () => api.post<RecurringPreview>("/api/recurring/preview", input),
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
      queryClient.invalidateQueries({ queryKey: recurringKeys.list }),
      options.periods ? queryClient.invalidateQueries({ queryKey: periodKeys.all }) : null,
      options.periods ? queryClient.invalidateQueries({ queryKey: recurringKeys.transactions }) : null,
    ]);
}

export function useCreateRecurring() {
  return useMutation({
    mutationFn: (input: RecurringInput) => api.post<RecurringResponse>("/api/recurring", input),
    onSuccess: useRefresh({ periods: true }),
  });
}

export function useUpdateRecurring() {
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: RecurringPatch }) =>
      api.patch<RecurringResponse>(`/api/recurring/${id}`, patch),
    // Editing the template never changes existing transactions, so periods stay as they are.
    onSuccess: useRefresh({ periods: false }),
  });
}

export function useDeleteRecurring() {
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/recurring/${id}`),
    onSuccess: useRefresh({ periods: true }),
  });
}

export function useEndRecurring() {
  return useMutation({
    mutationFn: ({ id, removeUpcoming }: { id: string; removeUpcoming: boolean }) =>
      api.post<RecurringResponse>(`/api/recurring/${id}/end`, { removeUpcoming }),
    onSuccess: useRefresh({ periods: true }),
  });
}
