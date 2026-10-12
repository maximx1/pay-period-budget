// Noticing that nobody has used the app for a while. What happens then is the caller's
// business: the web app signs out, the Android app locks (see features/auth/IdleGuard.tsx).
//
// The time of the last activity is kept in localStorage, so that every tab of the web app
// shares it (using one tab keeps the others alive) and so that it survives a reload or the
// app being closed: coming back after too long is caught the moment the app opens.

const ACTIVITY_KEY = "ppb.lastActivity";
const NOTICE_KEY = "ppb.idleSignOutMinutes";

/** Used when the server cannot be asked how long the timeout is. */
export const DEFAULT_IDLE_TIMEOUT_MINUTES = 10;
/** How often the watch looks at the clock. The timeout is late by at most this much. */
export const IDLE_CHECK_EVERY_MS = 15 * 1000;
/** Activity is written down at most this often. */
const ACTIVITY_RESOLUTION_MS = 5 * 1000;
/**
 * While the web app is in use it lets the server know at least this often, so the server's
 * own idle timeout (which allows two minutes more) never ends a session that is being used.
 */
export const IDLE_KEEPALIVE_MS = 30 * 1000;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// The copy in memory covers a browser that refuses storage (some private modes).
let remembered: number | null = null;

function storageOrNull(kind: "localStorage" | "sessionStorage"): StorageLike | null {
  try {
    return globalThis[kind] ?? null;
  } catch {
    return null;
  }
}

/** When the app was last used, on this device, or null if never recorded. */
export function lastActivity(storage: StorageLike | null = storageOrNull("localStorage")): number | null {
  let stored: number | null = null;
  try {
    const value = Number(storage?.getItem(ACTIVITY_KEY));
    if (Number.isFinite(value) && value > 0) stored = value;
  } catch {
    // Unreadable storage: fall back on memory.
  }
  if (stored === null) return remembered;
  return remembered === null ? stored : Math.max(stored, remembered);
}

/** Records that the app is being used now: a sign-in, an unlock, or any input. */
export function markActive(now: number = Date.now(), storage: StorageLike | null = storageOrNull("localStorage")): void {
  remembered = now;
  try {
    storage?.setItem(ACTIVITY_KEY, String(now));
  } catch {
    // Memory will do.
  }
}

/** Whether the app has gone unused for `limitMs` or longer. Never, if no use was ever recorded. */
export function isIdle(
  limitMs: number,
  now: number = Date.now(),
  storage: StorageLike | null = storageOrNull("localStorage"),
): boolean {
  const last = lastActivity(storage);
  return last !== null && now - last >= limitMs;
}

export type IdleWatchOptions = {
  limitMs: number;
  /** Called once, when the limit has passed. The watch stops itself first. */
  onIdle: () => void;
  /** Called while the app is in use, at most every ACTIVITY_RESOLUTION_MS. */
  onActive?: (now: number) => void;
  now?: () => number;
  storage?: StorageLike | null;
  /** Where input events are heard, and whose visibility is watched. */
  target?: EventTarget;
  document?: { visibilityState: string } & EventTarget;
};

const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;

let recheck: (() => void) | null = null;

/** Looks at the clock now, if a watch is running. For moments a timer may have slept through. */
export function recheckIdle(): void {
  recheck?.();
}

/**
 * Watches for the app going unused. Any input counts as use. Returns the function that
 * stops the watch. A first input after the limit has passed does not count: it finds the
 * app idle, like any other check.
 */
export function startIdleWatch(options: IdleWatchOptions): () => void {
  const { limitMs, onIdle, onActive, now = Date.now } = options;
  const storage = options.storage === undefined ? storageOrNull("localStorage") : options.storage;
  const target = options.target ?? window;
  const doc = options.document ?? document;
  let stopped = false;
  let lastWritten = 0;

  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    for (const name of INPUT_EVENTS) target.removeEventListener(name, onInput, true);
    doc.removeEventListener("visibilitychange", check);
    if (recheck === check) recheck = null;
  }

  function check() {
    if (stopped || !isIdle(limitMs, now(), storage)) return;
    stop();
    onIdle();
  }

  function onInput() {
    if (stopped) return;
    const moment = now();
    if (moment - lastWritten < ACTIVITY_RESOLUTION_MS) return;
    // Someone coming back after the limit is not "activity": they find the app idle.
    check();
    if (stopped) return;
    lastWritten = moment;
    markActive(moment, storage);
    onActive?.(moment);
  }

  // Nothing recorded yet (the first run since this was added): the clock starts now.
  if (lastActivity(storage) === null) markActive(now(), storage);

  for (const name of INPUT_EVENTS) target.addEventListener(name, onInput, { capture: true, passive: true });
  doc.addEventListener("visibilitychange", check);
  const timer = setInterval(check, IDLE_CHECK_EVERY_MS);
  recheck = check;
  check();
  return stop;
}

/** Remembers, for the sign-in page, that the app signed out by itself after this many minutes. */
export function noteIdleSignOut(minutes: number, storage: StorageLike | null = storageOrNull("sessionStorage")): void {
  try {
    storage?.setItem(NOTICE_KEY, String(minutes));
  } catch {
    // The notice is a courtesy.
  }
}

/** The minutes from `noteIdleSignOut`, or null if the last sign-out was not an idle one. */
export function idleSignOutMinutes(storage: StorageLike | null = storageOrNull("sessionStorage")): number | null {
  try {
    const minutes = Number(storage?.getItem(NOTICE_KEY));
    return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
  } catch {
    return null;
  }
}

export function clearIdleSignOut(storage: StorageLike | null = storageOrNull("sessionStorage")): void {
  try {
    storage?.removeItem(NOTICE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** For tests: forget what this module remembers between calls. */
export function resetIdleMemory(): void {
  remembered = null;
  recheck = null;
}
