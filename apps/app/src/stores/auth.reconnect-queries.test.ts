/**
 * C1 end to end with the REAL query layer: a profile read that failed while the
 * rep was held on their stored session must load again when auth-js confirms
 * the session on its own (TOKEN_REFRESHED), not only when useReconnect wins.
 */
import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

const { getSession, refreshSession, onAuthStateChange } = vi.hoisted(() => ({
  getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
  refreshSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
  onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
}));
vi.mock("@/lib/supabase", () => ({
  AUTH_STORAGE_KEY: "navigatr-auth",
  supabase: { auth: { getSession, refreshSession, onAuthStateChange } },
}));
vi.mock("@/lib/observability", () => ({
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
  setUser: vi.fn(),
}));

import { useAuth, holdProvisionalSession } from "./auth";
import { bindQueryClient } from "@/lib/sessionQueries";

const watcher = onAuthStateChange.mock.calls[0][0] as (event: string, s: unknown) => void;

describe("a hold ended by auth-js reloads the failed profile read", () => {
  it("refetches the errored profile query on TOKEN_REFRESHED", async () => {
    const store = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
    const user = { id: "rep-1", email: "r@example.com", user_metadata: {} };
    store.set("navigatr-auth", JSON.stringify({ access_token: "old", user }));

    const qc = new QueryClient({ defaultOptions: { queries: { retry: 0 } } });
    bindQueryClient(qc);
    const profileFn = vi
      .fn()
      .mockRejectedValueOnce({ code: "42501", message: "permission denied for table profiles", details: null, hint: null })
      .mockResolvedValue({ id: "rep-1" });
    const observer = new QueryObserver(qc, { queryKey: ["profile", "rep-1"], queryFn: profileFn });
    const unsubscribe = observer.subscribe(() => {});

    useAuth.setState({ user: null, session: null, loading: false, reconnecting: false });
    expect(holdProvisionalSession()).toBe(true);
    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe("error"));

    watcher("TOKEN_REFRESHED", { access_token: "new", user });

    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe("success"));
    expect(profileFn).toHaveBeenCalledTimes(2);
    expect(useAuth.getState().reconnecting).toBe(false);
    unsubscribe();
    bindQueryClient(null);
  });
});
