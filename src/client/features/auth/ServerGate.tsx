import { useQueryClient } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { type FormEvent, type ReactNode, useState, useSyncExternalStore } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { TextField } from "../../components/ui/TextField.tsx";
import { probeServer } from "../../lib/api.ts";
import {
  forgetServerUrl,
  getServerUrl,
  hasServerUrl,
  parseServerUrl,
  previousServerUrl,
  setServerUrl,
  subscribeToServerUrl,
} from "../../lib/serverUrl.ts";
import { clearToken } from "../../lib/sessionStore.ts";

/**
 * The Android app's first screen: until it knows which server to talk to, nothing else
 * (sign-in included) is shown. A browser always knows, so there this renders the app.
 */
export function ServerGate({ children }: { children: ReactNode }) {
  const connected = useSyncExternalStore(subscribeToServerUrl, hasServerUrl);
  return connected ? children : <ConnectToServer />;
}

function ConnectToServer() {
  const [address, setAddress] = useState(previousServerUrl);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function connect(event: FormEvent) {
    event.preventDefault();
    const parsed = parseServerUrl(address);
    if ("error" in parsed) return setError(parsed.error);

    setChecking(true);
    setError(null);
    const result = await probeServer(parsed.url);
    if (result === "ok") return setServerUrl(parsed.url);

    setChecking(false);
    setError(
      result === "unreachable"
        ? `Couldn't reach a budget server at ${parsed.url}. Check the address and your connection. If both are right, the server may not be set to allow the app.`
        : "Something answered at that address, but it isn't a Pay Period Budget server.",
    );
  }

  return (
    <main className="flex min-h-full items-center justify-center px-4 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-fg">
            <Wallet className="size-6" aria-hidden />
          </div>
          <h1 className="text-2xl font-bold text-fg">Pay Period Budget</h1>
          <p className="text-sm text-muted">Connect to your server to get started.</p>
        </div>

        <Card padding="lg" className="shadow-sm">
          <form onSubmit={connect} noValidate className="flex flex-col gap-4">
            <TextField
              label="Server address"
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="https://budget.example.com"
              value={address}
              onChange={(event) => {
                setAddress(event.target.value);
                setError(null);
              }}
              error={error ?? undefined}
              hint="The address you open Pay Period Budget at in a browser."
            />
            <Button type="submit" loading={checking}>
              Connect
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}

/** Under the sign-in form in the Android app: which server this is, and a way to change it. */
export function ConnectedServer() {
  const queryClient = useQueryClient();

  async function change() {
    // A sign-in belongs to the server it was made on; none of it carries over.
    await clearToken();
    await forgetServerUrl();
    queryClient.clear();
  }

  return (
    <p className="mt-4 flex flex-wrap items-center justify-center gap-x-1 text-center text-sm text-muted">
      <span className="min-w-0 break-all">{getServerUrl().replace(/^https?:\/\//, "")}</span>
      <button
        type="button"
        onClick={change}
        className="min-h-11 rounded-lg px-2 font-semibold text-primary hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Change server
      </button>
    </p>
  );
}
