import { LogOut } from "lucide-react";
import { Button } from "../../components/ui/Button.tsx";
import { useCurrentUser, useLogout } from "../auth/session.ts";

// Placeholder landing screen. Phase 2 replaces this with the app shell (side panel + routed pages).
export function HomePage() {
  const user = useCurrentUser();
  const logout = useLogout();

  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-bold">You're signed in</h1>
      <p className="text-muted">
        {user.username} · {user.email}
      </p>
      <Button variant="secondary" onClick={() => logout.mutate()} loading={logout.isPending}>
        <LogOut className="size-4" aria-hidden />
        Sign out
      </Button>
    </main>
  );
}
