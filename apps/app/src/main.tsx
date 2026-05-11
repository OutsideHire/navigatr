import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { App } from "@/App";
import "@/index.css";
// Side-effect imports — order matters:
//   1. theme:   applies persisted light/dark to <html> before first paint
//   2. install: wires `beforeinstallprompt` + `appinstalled` listeners
//   3. pwa:     registers the service worker (no-op in dev)
import "@/stores/theme";
import "@/stores/install";
import "@/pwa";

const queryClient = new QueryClient({
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
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  </React.StrictMode>,
);
