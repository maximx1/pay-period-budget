import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { ToastProvider } from "./components/ui/Toaster.tsx";
import { BiometricGate } from "./features/auth/BiometricGate.tsx";
import { SESSION_QUERY_KEY } from "./features/auth/session.ts";
import { setUnauthenticatedHandler } from "./lib/api.ts";
import { isNative } from "./lib/platform.ts";
import { loadToken } from "./lib/sessionStore.ts";
import { router } from "./router.tsx";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30 * 1000, retry: 1, refetchOnWindowFocus: true },
  },
});

// A 401 from any request means the session ended; RequireAuth then routes to /login.
setUnauthenticatedHandler(() => queryClient.setQueryData(SESSION_QUERY_KEY, null));

// In the Android app the stored session token has to be in memory before the first request.
await loadToken();
if (isNative) void import("./lib/nativeShell.ts").then((shell) => shell.initNativeShell());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BiometricGate>
          <RouterProvider router={router} />
        </BiometricGate>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
