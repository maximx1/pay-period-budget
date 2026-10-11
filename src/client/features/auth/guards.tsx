import { Navigate, Outlet, useLocation } from "react-router";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { FullPageSpinner } from "../../components/ui/FullPageSpinner.tsx";
import { CurrentUserProvider, useSession } from "./session.ts";

type RedirectState = { from?: string } | null;

function SessionError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-4">
      <Alert>Can't reach the server right now.</Alert>
      <Button variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/** Renders child routes only for a signed-in user; everyone else goes to /login. */
export function RequireAuth() {
  const session = useSession();
  const location = useLocation();

  if (session.isPending) return <FullPageSpinner />;
  if (session.isError) return <SessionError onRetry={() => session.refetch()} />;
  if (!session.data) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return (
    <CurrentUserProvider value={session.data}>
      <Outlet />
    </CurrentUserProvider>
  );
}

/** Renders child routes only when signed out; a signed-in user is sent back into the app. */
export function PublicOnly() {
  const session = useSession();
  const location = useLocation();

  if (session.isPending) return <FullPageSpinner />;
  if (session.isError) return <SessionError onRetry={() => session.refetch()} />;
  if (session.data) {
    return <Navigate to={(location.state as RedirectState)?.from ?? "/"} replace />;
  }
  return <Outlet />;
}
