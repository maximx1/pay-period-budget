import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChangePasswordInput, SessionListResponse } from "../../../shared/auth.ts";
import type { BudgetResponse } from "../../../shared/budget.ts";
import { api } from "../../lib/api.ts";
import { BUDGET_QUERY_KEY } from "../budget/api.ts";
import { periodKeys } from "../periods/api.ts";

const DEVICES_QUERY_KEY = ["devices"] as const;

/** Where the account is signed in. */
export function useDevices() {
  return useQuery({
    queryKey: DEVICES_QUERY_KEY,
    queryFn: async () => (await api.get<SessionListResponse>("/api/auth/sessions")).sessions,
  });
}

function useRefreshDevices() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: DEVICES_QUERY_KEY });
}

export function useSignOutDevice() {
  return useMutation({
    mutationFn: (sessionId: string) => api.delete<void>(`/api/auth/sessions/${sessionId}`),
    onSuccess: useRefreshDevices(),
  });
}

export function useSignOutOtherDevices() {
  return useMutation({
    mutationFn: () => api.post<void>("/api/auth/sessions/revoke-others"),
    onSuccess: useRefreshDevices(),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: ChangePasswordInput) => api.post<void>("/api/auth/password", input),
    // Changing the password signs every other device out.
    onSuccess: useRefreshDevices(),
  });
}

export function useSetTimezone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (timezone: string) => api.patch<BudgetResponse>("/api/settings", { timezone }),
    onSuccess: ({ budget }) => {
      queryClient.setQueryData(BUDGET_QUERY_KEY, budget);
      // "Today", and so which period is current, may have changed.
      return queryClient.invalidateQueries({ queryKey: periodKeys.all });
    },
  });
}
