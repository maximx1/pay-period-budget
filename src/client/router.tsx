import { createBrowserRouter, Navigate, type RouteObject } from "react-router";
import { ErrorPage } from "./components/ErrorPage.tsx";
import { AuthPage } from "./features/auth/AuthPage.tsx";
import { PublicOnly, RequireAuth } from "./features/auth/guards.tsx";
import { RequireBudget, RequireNoBudget } from "./features/budget/guards.tsx";
import { SetupPage } from "./features/budget/SetupPage.tsx";
import { HomePage } from "./features/home/HomePage.tsx";
import { RecurringPage } from "./features/recurring/RecurringPage.tsx";
import { DateSearchPage } from "./features/search/DateSearchPage.tsx";
import { SettingsPage } from "./features/settings/SettingsPage.tsx";
import { AppShell } from "./features/shell/AppShell.tsx";

// Only reachable from the dev server; the import is dropped from production builds.
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: "/dev/ui",
        lazy: async () => ({ Component: (await import("./features/dev/UiKitPage.tsx")).UiKitPage }),
      },
    ]
  : [];

export const router = createBrowserRouter([
  {
    errorElement: <ErrorPage />,
    children: [
      {
        element: <PublicOnly />,
        children: [
          { path: "/login", element: <AuthPage mode="login" /> },
          { path: "/register", element: <AuthPage mode="register" /> },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <RequireNoBudget />,
            children: [{ path: "/setup", element: <SetupPage /> }],
          },
          {
            element: <RequireBudget />,
            children: [
              {
                element: <AppShell />,
                children: [
                  { path: "/", element: <HomePage /> },
                  { path: "/periods/:periodId", element: <HomePage /> },
                  { path: "/search", element: <DateSearchPage /> },
                  { path: "/recurring", element: <RecurringPage /> },
                  { path: "/settings", element: <SettingsPage /> },
                  ...devRoutes,
                ],
              },
            ],
          },
        ],
      },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
