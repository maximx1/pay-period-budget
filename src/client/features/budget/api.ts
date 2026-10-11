import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Budget, BudgetResponse, BudgetSetupInput } from "../../../shared/budget.ts";
import { api } from "../../lib/api.ts";

export const BUDGET_QUERY_KEY = ["budget"] as const;

/** The user's budget schedule, or null if they haven't set one up yet. */
export function useBudget() {
  return useQuery({
    queryKey: BUDGET_QUERY_KEY,
    queryFn: async (): Promise<Budget | null> => (await api.get<BudgetResponse>("/api/budget")).budget,
    // Only changes through setup (and, later, settings), both of which update the cache themselves.
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useSetupBudget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BudgetSetupInput) => api.post<BudgetResponse>("/api/budget", input),
    onSuccess: ({ budget }) => queryClient.setQueryData(BUDGET_QUERY_KEY, budget),
  });
}
