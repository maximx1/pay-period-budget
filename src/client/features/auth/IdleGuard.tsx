import { type ReactNode, useEffect, useRef } from "react";
import { FullPageSpinner } from "../../components/ui/FullPageSpinner.tsx";
import { api } from "../../lib/api.ts";
import { IDLE_KEEPALIVE_MS, isIdle, noteIdleSignOut, startIdleWatch } from "../../lib/idle.ts";
import { isNative } from "../../lib/platform.ts";
import { biometricUnlockEnabled, lock } from "../../lib/sessionStore.ts";
import { useIdleTimeoutMinutes, useLogout } from "./session.ts";

/**
 * Wraps everything a signed-in user sees. When the app has gone unused for the idle
 * timeout it is closed: the Android app with biometric unlock on locks, and anything else
 * (a browser, or the app without that) signs out. Coming back to an app left open too
 * long, or reopening it, is caught before any of it is shown.
 */
export function IdleGuard({ children }: { children: ReactNode }) {
  const minutes = useIdleTimeoutMinutes();
  const logout = useLogout();
  const limitMs = (minutes ?? 0) * 60 * 1000;

  // The latest of each, without restarting the watch when they change identity.
  const act = useRef({ minutes, signOut: logout.mutate });
  act.current = { minutes, signOut: logout.mutate };

  useEffect(() => {
    if (limitMs <= 0) return;
    let lastKeepalive = Date.now();

    return startIdleWatch({
      limitMs,
      onIdle() {
        if (isNative && biometricUnlockEnabled()) return lock();
        noteIdleSignOut(act.current.minutes ?? 0);
        act.current.signOut();
      },
      onActive(now) {
        // A browser's session also ends on the server when no request arrives for this
        // long. Reading and typing make no requests, so say "still here" now and then.
        if (isNative || now - lastKeepalive < IDLE_KEEPALIVE_MS) return;
        lastKeepalive = now;
        void api.get("/api/auth/me").catch(() => undefined);
      },
    });
  }, [limitMs]);

  // Not yet known how long the timeout is, or already past it (the effect above is about
  // to close the app): show nothing of the budget meanwhile.
  if (minutes === undefined || (limitMs > 0 && isIdle(limitMs))) return <FullPageSpinner />;
  return children;
}
