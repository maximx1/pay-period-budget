import { Navigate, Outlet, useLocation } from "react-router";
import { LoadErrorPage } from "../../components/LoadErrorPage.tsx";
import { FullPageSpinner } from "../../components/ui/FullPageSpinner.tsx";
import { isNative } from "../../lib/platform.ts";
import { BiometricOffer } from "./BiometricOffer.tsx";
import { CurrentUserProvider, useSession } from "./session.ts";

type RedirectState = { from?: string } | null;

/** Renders child routes only for a signed-in user; everyone else goes to /login. */
export function RequireAuth() {
  const session = useSession();
  const location = useLocation();

  if (session.isPending) return <FullPageSpinner />;
  if (session.isError) return <LoadErrorPage onRetry={() => session.refetch()} />;
  if (!session.data) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return (
    <CurrentUserProvider value={session.data}>
      <Outlet />
      {isNative && <BiometricOffer />}
    </CurrentUserProvider>
  );
}

/** Renders child routes only when signed out; a signed-in user is sent back into the app. */
export function PublicOnly() {
  const session = useSession();
  const location = useLocation();

  if (session.isPending) return <FullPageSpinner />;
  if (session.isError) return <LoadErrorPage onRetry={() => session.refetch()} />;
  if (session.data) {
    return <Navigate to={(location.state as RedirectState)?.from ?? "/"} replace />;
  }
  return <Outlet />;
}
