import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryCache, MutationCache, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Toaster } from "sonner";
import { App } from "@/App";
import { initObservability, reportCacheError } from "@/lib/observability";
import { installChunkReloadHandler } from "@/lib/chunkReload";
import "@/index.css";

// Observability MUST init before any other side-effect import — otherwise
// errors thrown during auth bootstrap or service-worker registration
// would happen before Sentry is listening. No-op if VITE_SENTRY_DSN unset.
initObservability();

// Reload once if a lazy route chunk 404s after a deploy (stale hashed chunk),
// instead of showing a blank page.
installChunkReloadHandler();

// Side-effect imports — order matters:
//   1. theme:   applies persisted light/dark to <html> before first paint
//   2. install: wires `beforeinstallprompt` + `appinstalled` listeners
//   3. auth:    bootstraps Supabase session, subscribes to onAuthStateChange
//   4. api:     binds the generated SDK to our axios instance + interceptors
//   5. pwa:     registers the service worker (no-op in dev)
import "@/stores/theme";
import "@/stores/install";
import "@/stores/auth";
import "@/api";
import "@/pwa";

const queryClient = new QueryClient({
  // Report query load failures to Sentry so a silently-failing read (which
  // otherwise just renders a spinner or empty state) is visible. Skip offline
  // errors — they're expected and noisy; Sentry groups the rest.
  queryCache: new QueryCache({
    onError: reportCacheError("react-query"),
  }),
  // Same for mutations: a failed save/update otherwise only toasts and is
  // invisible to us. Tagged separately so the two can be filtered apart.
  mutationCache: new MutationCache({
    onError: reportCacheError("react-query-mutation"),
  }),
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster
        position="top-center"
        toastOptions={{
          classNames: {
            toast:
              "bg-surface-elevated border border-border-subtle text-text-default shadow-md rounded-radius-md",
            description: "text-text-muted",
            error: "border-status-danger/30",
            success: "border-status-success/30",
          },
        }}
      />
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  </React.StrictMode>,
);
