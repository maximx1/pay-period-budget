import { Preferences } from "@capacitor/preferences";
import { isNative } from "./platform.ts";

// Where the Android app keeps its session token. A browser never holds one: its session
// is the httpOnly cookie, so everything here does nothing on the web.
const STORAGE_KEY = "session.token";

// Device storage is asynchronous; this copy lets api.ts read the token without waiting.
let current: string | null = null;

/**
 * Reads the stored token into memory. Must finish before the first API request, or the app
 * would ask a signed-in user for their password on every launch.
 */
export async function loadToken(): Promise<void> {
  if (!isNative) return;
  try {
    current = (await Preferences.get({ key: STORAGE_KEY })).value;
  } catch {
    // Unreadable storage is the same as being signed out.
    current = null;
  }
}

export function getToken(): string | null {
  return current;
}

export async function setToken(token: string): Promise<void> {
  if (!isNative) return;
  current = token;
  await Preferences.set({ key: STORAGE_KEY, value: token });
}

export async function clearToken(): Promise<void> {
  if (!isNative) return;
  current = null;
  await Preferences.remove({ key: STORAGE_KEY });
}
