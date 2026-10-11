import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import type { AuthResponse, LoginInput, PublicUser, RegisterInput } from "../../../shared/auth.ts";
import { ApiError, api } from "../../lib/api.ts";

export const SESSION_QUERY_KEY = ["session"] as const;

async function fetchSession(): Promise<PublicUser | null> {
  try {
    return (await api.get<AuthResponse>("/api/auth/me")).user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

/** The signed-in user, or null when signed out. `isPending` while the first check is in flight. */
export function useSession() {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: fetchSession,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

const CurrentUserContext = createContext<PublicUser | null>(null);
export const CurrentUserProvider = CurrentUserContext.Provider;

/**
 * The signed-in user, for anything rendered inside RequireAuth. Reads the value RequireAuth
 * provides rather than the session query, so it can never observe the signed-out state.
 */
export function useCurrentUser(): PublicUser {
  const user = useContext(CurrentUserContext);
  if (!user) throw new Error("useCurrentUser used outside RequireAuth");
  return user;
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api.post<AuthResponse>("/api/auth/login", input),
    onSuccess: ({ user }) => queryClient.setQueryData(SESSION_QUERY_KEY, user),
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) => api.post<AuthResponse>("/api/auth/register", input),
    onSuccess: ({ user }) => queryClient.setQueryData(SESSION_QUERY_KEY, user),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>("/api/auth/logout"),
    onSettled: () => {
      // Signing out first unmounts the app; then drop its cached data so none of it
      // outlives the session.
      queryClient.setQueryData(SESSION_QUERY_KEY, null);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== SESSION_QUERY_KEY[0] });
    },
  });
}
