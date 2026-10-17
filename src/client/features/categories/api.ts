import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CategoryInput,
  CategoryListResponse,
  CategoryMove,
  CategoryMoveResponse,
  CategoryPatch,
  CategoryResponse,
} from "../../../shared/categories.ts";
import { api } from "../../lib/api.ts";
import { billsIncomeKeys } from "../billsIncome/api.ts";
import { periodKeys } from "../periods/api.ts";

export const categoryKeys = {
  all: ["categories"] as const,
  list: ["categories", "list"] as const,
};

/** The user's categories, by name. */
export function useCategories() {
  return useQuery({
    queryKey: categoryKeys.list,
    queryFn: async () => (await api.get<CategoryListResponse>("/api/categories")).categories,
  });
}

// A category's name and limits show in every period, and deleting or moving one refiles
// transactions and bills, so each change refreshes those too.
function useRefresh() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: categoryKeys.all }),
      queryClient.invalidateQueries({ queryKey: periodKeys.all }),
      queryClient.invalidateQueries({ queryKey: billsIncomeKeys.all }),
    ]);
}

export function useCreateCategory() {
  return useMutation({
    mutationFn: (input: CategoryInput) => api.post<CategoryResponse>("/api/categories", input),
    onSuccess: useRefresh(),
  });
}

export function useUpdateCategory() {
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: CategoryPatch }) =>
      api.patch<CategoryResponse>(`/api/categories/${id}`, patch),
    onSuccess: useRefresh(),
  });
}

export function useDeleteCategory() {
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/categories/${id}`),
    onSuccess: useRefresh(),
  });
}

/** Moves everything filed under a category to another, and deletes it afterwards if asked. */
export function useMoveCategory() {
  return useMutation({
    mutationFn: ({ id, move }: { id: string; move: CategoryMove }) =>
      api.post<CategoryMoveResponse>(`/api/categories/${id}/move`, move),
    onSuccess: useRefresh(),
  });
}
