import { Preferences } from "@capacitor/preferences";
import { isNative } from "./platform.ts";

// Where the API is. A browser gets the app from the server it talks to, so the answer
// there is "the same place" (an empty prefix). The Android app carries its own copy of
// the pages, so it has to be told: the user types the address once and it is remembered.
const STORAGE_KEY = "server.url";

/** Baked in at build time. Empty on the web; in the app, an optional address to start with. */
const BUILT_IN: string = import.meta.env.VITE_API_BASE_URL ?? "";

/** Hosts a debug build may reach over plain http: the development machine. */
const DEV_HOSTS = new Set(["localhost", "127.0.0.1", "10.0.2.2"]);

let current: string | null = isNative ? null : BUILT_IN;
/** What was connected before "change server", to start the form with. */
let previous = "";
const listeners = new Set<() => void>();

function setCurrent(next: string | null) {
  if (current === next) return;
  current = next;
  for (const listener of listeners) listener();
}

/**
 * Turns what someone typed ("budget.mysite.com", "https://budget.mysite.com/login") into
 * the server's origin ("https://budget.mysite.com"), or says what is wrong with it.
 */
export function parseServerUrl(input: string): { url: string } | { error: string } {
  const typed = input.trim();
  if (!typed) return { error: "Enter your server's address" };

  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`);
  } catch {
    return { error: "That doesn't look like a web address" };
  }
  if (parsed.username || parsed.password) return { error: "Leave the username and password out of the address" };
  if (parsed.protocol === "http:" && DEV_HOSTS.has(parsed.hostname)) return { url: parsed.origin };
  if (parsed.protocol !== "https:") return { error: "The address must start with https://" };
  return { url: parsed.origin };
}

/** Reads the remembered address at start-up. Must finish before the first API request. */
export async function loadServerUrl(): Promise<void> {
  if (!isNative) return;
  let stored: string | null = null;
  try {
    stored = (await Preferences.get({ key: STORAGE_KEY })).value;
  } catch {
    // Unreadable storage: fall back to the built-in address, or ask.
  }
  setCurrent(stored || BUILT_IN || null);
}

/** The prefix for every API path. Empty means "this origin". */
export function getServerUrl(): string {
  return current ?? "";
}

/** False only in the Android app before it has been pointed at a server. */
export function hasServerUrl(): boolean {
  return current !== null;
}

export function subscribeToServerUrl(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Remembers the address. Pass one that `parseServerUrl` produced and the server answered at. */
export async function setServerUrl(url: string): Promise<void> {
  if (!isNative) return;
  await Preferences.set({ key: STORAGE_KEY, value: url });
  setCurrent(url);
}

/** Back to "not connected", so the app asks again. The old address is kept to edit. */
export async function forgetServerUrl(): Promise<void> {
  if (!isNative) return;
  previous = current ?? "";
  await Preferences.remove({ key: STORAGE_KEY });
  setCurrent(null);
}

export function previousServerUrl(): string {
  return previous;
}
