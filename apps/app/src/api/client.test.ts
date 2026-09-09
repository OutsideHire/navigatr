/**
 * client.test.ts — the boot-time (pre-mount) 401 handler must be inert.
 *
 * Regression guard for the mobile-logout fix: the default onUnauthorized used
 * to signOut() + hard-redirect to /login. A lone 401 during a transient
 * token-refresh race on resume would then destroy a recoverable session and
 * reload. The default is now a no-op; the router-aware handler installed at
 * mount, plus ProtectedRoute session recovery, own genuine session loss.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const signOut = vi.hoisted(() => vi.fn().mockResolvedValue({ error: null }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      signOut,
    },
  },
}));
// The generated SDK is rebound to our axios instance at import; stub it out.
vi.mock("@/api/generated/client.gen", () => ({ client: { setConfig: vi.fn() } }));

import { apiClient, NavigatrApiError } from "./client";

describe("api client: boot-time 401 handler is defused", () => {
  beforeEach(() => {
    signOut.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (apiClient.defaults as { adapter?: unknown }).adapter;
  });

  it("does not signOut or hard-redirect on a 401 before a handler is installed", async () => {
    // Adapter forces a 401 so the response interceptor's unauthorized branch
    // runs with the default (boot-time) handler still in place.
    apiClient.defaults.adapter = () => {
      const err = new Error("unauthorized") as Error & Record<string, unknown>;
      err.isAxiosError = true;
      err.response = {
        status: 401,
        data: { message: "nope" },
        headers: {},
        statusText: "Unauthorized",
        config: {},
      };
      return Promise.reject(err);
    };

    await expect(apiClient.get("/anything")).rejects.toBeInstanceOf(NavigatrApiError);

    // The whole point: a transient boot-time 401 must not tear down the session.
    // The old handler called signOut() unconditionally (before any redirect), so
    // "signOut not called" definitively proves the dangerous path didn't run.
    expect(signOut).not.toHaveBeenCalled();
  });
});
