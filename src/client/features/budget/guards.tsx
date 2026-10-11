import { Navigate, Outlet } from "react-router";
import { LoadErrorPage } from "../../components/LoadErrorPage.tsx";
import { FullPageSpinner } from "../../components/ui/FullPageSpinner.tsx";
import { useBudget } from "./api.ts";

/** Renders child routes once the user has a budget; until then everything leads to /setup. */
export function RequireBudget() {
  const budget = useBudget();

  if (budget.isPending) return <FullPageSpinner />;
  if (budget.isError) return <LoadErrorPage onRetry={() => budget.refetch()} />;
  if (!budget.data) return <Navigate to="/setup" replace />;
  return <Outlet />;
}

/** The reverse, for /setup itself: a user who already has a budget is sent into the app. */
export function RequireNoBudget() {
  const budget = useBudget();

  if (budget.isPending) return <FullPageSpinner />;
  if (budget.isError) return <LoadErrorPage onRetry={() => budget.refetch()} />;
  if (budget.data) return <Navigate to="/" replace />;
  return <Outlet />;
}
