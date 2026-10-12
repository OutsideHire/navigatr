import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpcMock(...a) } }));
const auth = vi.hoisted(() => ({ user: { id: "user-1" } as { id: string } | null }));
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) => selector({ user: auth.user }),
}));

import {
  REFERRAL_LINK_QUERY_KEY,
  toReferralLink,
  useMyReferralLink,
  useRegenerateReferralLink,
  useTenantReferralLink,
} from "./useReferralLinks";

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const spy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { wrapper, spy };
}

beforeEach(() => {
  rpcMock.mockReset();
  auth.user = { id: "user-1" };
});

describe("toReferralLink", () => {
  it("maps the first row, and null for nothing", () => {
    expect(toReferralLink([{ link_token: "tok", org_slug: "acme", public_form_enabled: true }])).toEqual({
      enabled: true,
      slug: "acme",
      token: "tok",
    });
    expect(toReferralLink({ link_token: null, org_slug: "acme", public_form_enabled: false })).toEqual({
      enabled: false,
      slug: "acme",
      token: null,
    });
    expect(toReferralLink([])).toBeNull();
    expect(toReferralLink(null)).toBeNull();
  });
});

describe("useMyReferralLink", () => {
  it("asks for the caller's link once signed in", async () => {
    rpcMock.mockResolvedValueOnce({ data: [{ link_token: "tok", org_slug: "acme", public_form_enabled: true }], error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useMyReferralLink(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith("get_my_referral_link");
    expect(result.current.data).toEqual({ enabled: true, slug: "acme", token: "tok" });
  });

  it("does nothing while signed out, and surfaces an error", async () => {
    auth.user = null;
    const { wrapper } = setup();
    const signedOut = renderHook(() => useMyReferralLink(), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(signedOut.result.current.fetchStatus).toBe("idle");
    expect(rpcMock).not.toHaveBeenCalled();

    auth.user = { id: "user-1" };
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "not_authorized" } });
    const { result } = renderHook(() => useMyReferralLink(), { wrapper: setup().wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useTenantReferralLink", () => {
  it("asks only when enabled (administrators with the sheet open)", async () => {
    const { wrapper } = setup();
    const off = renderHook(() => useTenantReferralLink(false), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(off.result.current.fetchStatus).toBe("idle");
    expect(rpcMock).not.toHaveBeenCalled();

    rpcMock.mockResolvedValueOnce({ data: [{ link_token: "ten", org_slug: "acme", public_form_enabled: true }], error: null });
    const { result } = renderHook(() => useTenantReferralLink(true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith("get_tenant_referral_link");
    expect(result.current.data?.token).toBe("ten");
  });
});

describe("useRegenerateReferralLink", () => {
  it("retires the link, returns the new one and refreshes both links", async () => {
    rpcMock.mockResolvedValueOnce({ data: "newtok", error: null });
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useRegenerateReferralLink(), { wrapper });
    await expect(result.current.mutateAsync({ linkType: "tenant" })).resolves.toBe("newtok");
    expect(rpcMock).toHaveBeenCalledWith("regenerate_referral_link", { p_link_type: "tenant" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["referral-links"] });
  });

  it("says so when the form is off (the server returns no token)", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useRegenerateReferralLink(), { wrapper });
    await expect(result.current.mutateAsync({ linkType: "user" })).rejects.toThrow("The referral form is turned off right now.");
  });

  it("explains a refusal and any other failure", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useRegenerateReferralLink(), { wrapper });
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "not_authorized" } });
    await expect(result.current.mutateAsync({ linkType: "user" })).rejects.toThrow("You don't have access to do that.");
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(result.current.mutateAsync({ linkType: "user" })).rejects.toThrow("Couldn't get a new link. Try again.");
  });
});

describe("REFERRAL_LINK_QUERY_KEY", () => {
  it("keys by kind and user", () => {
    expect(REFERRAL_LINK_QUERY_KEY("user", "u-1")).toEqual(["referral-links", "user", "u-1"]);
    expect(REFERRAL_LINK_QUERY_KEY("tenant")).toEqual(["referral-links", "tenant", "anon"]);
  });
});
