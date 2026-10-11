import type { ApiErrorBody, ApiErrorCode } from "../../shared/api.ts";
import { isNative } from "./platform.ts";
import { clearToken, getToken } from "./sessionStore.ts";

// Empty on the web (same origin as the API). The Android build points this at the server.
const BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | "network",
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let onUnauthenticated: (() => void) | undefined;

/** Registers what happens when any request finds the session gone (e.g. it expired). */
export function setUnauthenticatedHandler(handler: () => void) {
  onUnauthenticated = handler;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  // The Android app carries its session in a header; a browser carries it in the cookie.
  const token = isNative ? getToken() : null;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(BASE_URL + path, {
      method,
      credentials: isNative ? "omit" : "include",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network", "Can't reach the server. Check your connection and try again.");
  }

  if (response.ok) {
    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  const payload = (await response.json().catch(() => null)) as ApiErrorBody | null;
  const error = new ApiError(
    response.status,
    payload?.error.code ?? "internal",
    payload?.error.message ?? "Something went wrong. Please try again.",
    payload?.error.fields,
  );
  if (error.code === "unauthenticated") {
    // Forget the token the server just refused, unless a newer sign-in has replaced it
    // while this request was in flight.
    if (token && token === getToken()) await clearToken().catch(() => undefined);
    onUnauthenticated?.();
  }
  throw error;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
