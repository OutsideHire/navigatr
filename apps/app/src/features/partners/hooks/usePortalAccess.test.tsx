import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpcMock = vi.fn();
const invokeMock = vi.fn();
const maybeSingleMock = vi.fn();
const calls: unknown[][] = [];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpcMock(...a),
    functions: { invoke: (...a: unknown[]) => invokeMock(...a) },
    from: (table: string) => {
      calls.push(["from", table]);
      const chain = {
        select: (...a: unknown[]) => {
          calls.push(["select", ...a]);
          return chain;
        },
        eq: (...a: unknown[]) => {
          calls.push(["eq", ...a]);
          return chain;
        },
        maybeSingle: () => maybeSingleMock(),
      };
      return chain;
    },
  },
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) => selector({ user: { id: "user-1" } }),
}));

import {
  useInviteToPortal,
  usePartnerPortalUser,
  usePortalStatus,
  useSetPortalAccess,
} from "./usePortalAccess";

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const spy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper, spy };
}

beforeEach(() => {
  rpcMock.mockReset();
  invokeMock.mockReset();
  maybeSingleMock.mockReset();
  calls.length = 0;
});

describe("usePortalStatus", () => {
  it("reads whether the org portal is on and its slug", async () => {
    rpcMock.mockResolvedValueOnce({ data: [{ enabled: true, slug: "acme" }], error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => usePortalStatus(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ enabled: true, slug: "acme" });
    expect(rpcMock).toHaveBeenCalledWith("get_portal_status");
  });
});

describe("usePartnerPortalUser", () => {
  it("reads only the safe portal_users columns", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: { partner_id: "p-1", status: "active", invited_at: "a", activated_at: "b", last_login_at: "c" },
      error: null,
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => usePartnerPortalUser("p-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      partnerId: "p-1",
      status: "active",
      invitedAt: "a",
      activatedAt: "b",
      lastLoginAt: "c",
    });
    expect(calls).toContainEqual(["from", "portal_users"]);
    expect(calls).toContainEqual(["select", "partner_id, status, invited_at, activated_at, last_login_at"]);
    expect(calls).toContainEqual(["eq", "partner_id", "p-1"]);
  });

  it("returns null when the partner was never invited", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => usePartnerPortalUser("p-2"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});

describe("useInviteToPortal", () => {
  it("invokes portal_invite and refreshes the partner's portal status", async () => {
    invokeMock.mockResolvedValueOnce({ data: { ok: true, emailed: true }, error: null });
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useInviteToPortal(), { wrapper });
    await expect(result.current.mutateAsync("p-1")).resolves.toEqual({ emailed: true });
    expect(invokeMock).toHaveBeenCalledWith("portal_invite", { body: { partnerId: "p-1" } });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ["portal", "user", "p-1"] }));
  });

  it("reports emailed false when the non-production email guard dropped the send", async () => {
    invokeMock.mockResolvedValueOnce({ data: { ok: true, emailed: false }, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useInviteToPortal(), { wrapper });
    await expect(result.current.mutateAsync("p-1")).resolves.toEqual({ emailed: false });
  });

  it("surfaces the server's error token", async () => {
    invokeMock.mockResolvedValueOnce({
      data: null,
      error: { message: "non-2xx", context: new Response(JSON.stringify({ error: "portal_disabled" }), { status: 409 }) },
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useInviteToPortal(), { wrapper });
    await expect(result.current.mutateAsync("p-1")).rejects.toThrow("portal_disabled");
  });

  it("still refreshes the portal status after email_failed, so the button flips to Resend", async () => {
    invokeMock.mockResolvedValueOnce({
      data: null,
      error: { message: "non-2xx", context: new Response(JSON.stringify({ error: "email_failed" }), { status: 502 }) },
    });
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useInviteToPortal(), { wrapper });
    await expect(result.current.mutateAsync("p-1")).rejects.toThrow("email_failed");
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ["portal", "user", "p-1"] }));
  });
});

describe("useSetPortalAccess", () => {
  it("calls portal_set_access and refreshes the partner's portal status", async () => {
    rpcMock.mockResolvedValueOnce({ data: "revoked", error: null });
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useSetPortalAccess(), { wrapper });
    await expect(result.current.mutateAsync({ partnerId: "p-1", status: "revoked" })).resolves.toBe("revoked");
    expect(rpcMock).toHaveBeenCalledWith("portal_set_access", { p_partner_id: "p-1", p_status: "revoked" });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ["portal", "user", "p-1"] }));
  });
});
