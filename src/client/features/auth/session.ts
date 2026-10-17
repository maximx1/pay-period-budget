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
import { clearIdleSignOut, DEFAULT_IDLE_TIMEOUT_MINUTES, markActive } from "../../lib/idle.ts";
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

/** What the server tells a client before anyone has signed in. Asked once and kept. */
function useAuthConfig() {
  return useQuery({
    queryKey: [SESSION_QUERY_KEY[0], "config"],
    queryFn: () => api.get<AuthConfigResponse>("/api/auth/config"),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** Whether this server lets new accounts be created. Undefined until known. */
export function useRegistrationOpen(): boolean | undefined {
  return useAuthConfig().data?.registrationOpen;
}

/**
 * Whether this server accepts API tokens, and so an assistant. Undefined until known; if
 * the server cannot be asked it is taken to be on, and the server has the last word anyway.
 */
export function useApiTokensEnabled(): boolean | undefined {
  const config = useAuthConfig();
  if (config.data) return config.data.apiTokensEnabled ?? true;
  return config.isError ? true : undefined;
}

/** Whether this server has the Advice page turned on with a model to ask. False until known. */
export function useAdviceEnabled(): boolean {
  return useAuthConfig().data?.adviceEnabled ?? false;
}

/**
 * Minutes without use after which the app closes itself: 0 for never, undefined until the
 * server has answered. If it cannot be asked, the usual ten minutes apply.
 */
export function useIdleTimeoutMinutes(): number | undefined {
  const config = useAuthConfig();
  if (config.data) return config.data.idleTimeoutMinutes ?? DEFAULT_IDLE_TIMEOUT_MINUTES;
  return config.isError ? DEFAULT_IDLE_TIMEOUT_MINUTES : undefined;
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
  const response = await signIn(path, input);
  // Signing in is use: the idle clock starts from here, not from whenever the app was last open.
  markActive();
  clearIdleSignOut();
  return response;
}

async function signIn(path: string, input: LoginInput | RegisterInput): Promise<AuthResponse> {
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
