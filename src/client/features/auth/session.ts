import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import type {
  AuthConfigResponse,
  AuthResponse,
  LoginInput,
  PublicUser,
  RegisterInput,
  TokenAuthResponse,
} from "../../../shared/auth.ts";
import { ApiError, api } from "../../lib/api.ts";
import { isNative } from "../../lib/platform.ts";
import { clearToken, setToken } from "../../lib/sessionStore.ts";

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

/** Whether this server lets new accounts be created. Undefined until known. */
export function useRegistrationOpen(): boolean | undefined {
  return useQuery({
    queryKey: [SESSION_QUERY_KEY[0], "config"],
    queryFn: () => api.get<AuthConfigResponse>("/api/auth/config"),
    staleTime: Number.POSITIVE_INFINITY,
  }).data?.registrationOpen;
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

/**
 * Signs in or registers. A browser is handed the session cookie; the Android app asks for
 * the token instead and keeps it for the Authorization header.
 */
async function authenticate(path: string, input: LoginInput | RegisterInput): Promise<AuthResponse> {
  if (!isNative) return api.post<AuthResponse>(path, input);
  const { user, token } = await api.post<TokenAuthResponse>(path, { ...input, transport: "token" });
  await setToken(token);
  return { user };
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => authenticate("/api/auth/login", input),
    onSuccess: ({ user }) => queryClient.setQueryData(SESSION_QUERY_KEY, user),
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) => authenticate("/api/auth/register", input),
    onSuccess: ({ user }) => queryClient.setQueryData(SESSION_QUERY_KEY, user),
  });
}

/** Makes the app signed out on this device: the screens unmount, then their cached data goes. */
export function dropSessionData(queryClient: QueryClient) {
  // Signing out first unmounts the app; then drop its cached data so none of it
  // outlives the session.
  queryClient.setQueryData(SESSION_QUERY_KEY, null);
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== SESSION_QUERY_KEY[0] });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>("/api/auth/logout"),
    onSettled: async () => {
      // Dropped even if the server could not be reached, so the phone is signed out either way.
      await clearToken().catch(() => undefined);
      dropSessionData(queryClient);
    },
  });
}
