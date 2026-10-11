import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  RecurringInput,
  RecurringListResponse,
  RecurringPatch,
  RecurringPreview,
  RecurringResponse,
} from "../../../shared/recurring.ts";
import { api } from "../../lib/api.ts";
import { periodKeys } from "../periods/api.ts";

export const recurringKeys = {
  all: ["recurring"] as const,
  list: ["recurring", "list"] as const,
  preview: (input: RecurringInput) => ["recurring", "preview", input] as const,
};

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
