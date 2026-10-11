import { createBrowserRouter, Navigate } from "react-router";
import { ErrorPage } from "./components/ErrorPage.tsx";
import { AuthPage } from "./features/auth/AuthPage.tsx";
import { PublicOnly, RequireAuth } from "./features/auth/guards.tsx";
import { HomePage } from "./features/home/HomePage.tsx";

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
        children: [{ path: "/", element: <HomePage /> }],
      },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
