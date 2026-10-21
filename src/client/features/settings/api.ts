import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ApiTokenCreatedResponse,
  ApiTokenInput,
  ApiTokenListResponse,
  ChangePasswordInput,
  SessionListResponse,
} from "../../../shared/auth.ts";
import type { BudgetResponse } from "../../../shared/budget.ts";
import type { LowBalanceSettings, LowBalanceSettingsResponse } from "../../../shared/outlook.ts";
import { api } from "../../lib/api.ts";
import { BUDGET_QUERY_KEY } from "../budget/api.ts";
import { periodKeys } from "../periods/api.ts";

const DEVICES_QUERY_KEY = ["devices"] as const;
const API_TOKENS_QUERY_KEY = ["api-tokens"] as const;

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
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ChangePasswordInput) => api.post<void>("/api/auth/password", input),
    // Changing the password signs every other device out and revokes every API token.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: DEVICES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: API_TOKENS_QUERY_KEY }),
      ]),
  });
}

/** The account's API tokens, newest first. Their secrets are never included. */
export function useApiTokens() {
  return useQuery({
    queryKey: API_TOKENS_QUERY_KEY,
    queryFn: async () => (await api.get<ApiTokenListResponse>("/api/auth/tokens")).tokens,
  });
}

function useRefreshApiTokens() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: API_TOKENS_QUERY_KEY });
}

/** Resolves with the new token's secret: the only time the server sends it. */
export function useCreateApiToken() {
  return useMutation({
    mutationFn: (input: ApiTokenInput) => api.post<ApiTokenCreatedResponse>("/api/auth/tokens", input),
    onSuccess: useRefreshApiTokens(),
  });
}

export function useRevokeApiToken() {
  return useMutation({
    mutationFn: (tokenId: string) => api.delete<void>(`/api/auth/tokens/${tokenId}`),
    onSuccess: useRefreshApiTokens(),
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

/** When the home screen warns about a coming pay period. Read back from the outlook. */
export function useSetLowBalance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: LowBalanceSettings) => api.put<LowBalanceSettingsResponse>("/api/settings/low-balance", settings),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: periodKeys.outlook }),
  });
}
