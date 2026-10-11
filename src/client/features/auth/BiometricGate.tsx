import { useQueryClient } from "@tanstack/react-query";
import { Fingerprint, Wallet } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { useToast } from "../../components/ui/Toaster.tsx";
import { clearToken, isLocked, subscribeToLock, unlock } from "../../lib/sessionStore.ts";
import { dropSessionData } from "./session.ts";

/**
 * Stands in for the whole app while the Android app is locked: at start-up with biometric
 * unlock on, and after a while in the background. Nothing behind it is mounted, so nothing
 * is shown and no request is made until the fingerprint check passes. A browser is never locked.
 */
export function BiometricGate({ children }: { children: ReactNode }) {
  const locked = useSyncExternalStore(subscribeToLock, isLocked);
  return locked ? <LockScreen /> : children;
}

function LockScreen() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [prompting, setPrompting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const asked = useRef(false);

  async function tryUnlock() {
    setPrompting(true);
    setMessage(null);
    const result = await unlock();
    // On success this screen is already gone.
    if (result === "unlocked") return;
    if (result === "gone") {
      dropSessionData(queryClient);
      toast("Fingerprint unlock isn't available any more. Sign in with your password.", { variant: "error" });
      return;
    }
    setPrompting(false);
    setMessage(result === "locked-out" ? "Too many tries. Wait a moment, or use your password." : null);
  }

  // Ask straight away, once: no need to make the user tap first.
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void tryUnlock();
  });

  async function usePassword() {
    await clearToken();
    dropSessionData(queryClient);
  }

  return (
    <main className="flex h-full items-center justify-center px-4 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <div className="flex w-full max-w-sm flex-col items-center gap-2 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-fg">
          <Wallet className="size-6" aria-hidden />
        </div>
        <h1 className="text-2xl font-bold text-fg">Pay Period Budget</h1>
        <p className="text-sm text-muted">Locked</p>
        {message && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {message}
          </p>
        )}
        <div className="mt-6 flex w-full flex-col gap-2">
          <Button onClick={tryUnlock} loading={prompting}>
            {!prompting && <Fingerprint className="size-4" aria-hidden />}
            Unlock
          </Button>
          <Button variant="ghost" onClick={usePassword} disabled={prompting}>
            Use password instead
          </Button>
        </div>
      </div>
    </main>
  );
}
