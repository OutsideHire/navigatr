import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpcMock(...a) } }));
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) => selector({ user: { id: "user-1" } }),
}));

import { useAssigneeSeesPartner, useReassignReferral, useReferralAssignees } from "./useReassignReferral";

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const spy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { wrapper, spy };
}

beforeEach(() => rpcMock.mockReset());

describe("useReferralAssignees", () => {
  it("lists who can take a referral, by name or email", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        { user_id: "u-2", full_name: "Rob Rep", email: "rob@acme.example" },
        { user_id: "u-3", full_name: null, email: "dee@acme.example" },
      ],
      error: null,
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useReferralAssignees(true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith("list_referral_assignees");
    expect(result.current.data).toEqual([
      { id: "u-2", name: "Rob Rep" },
      { id: "u-3", name: "dee@acme.example" },
    ]);
  });

  it("does not ask when disabled (reps never reassign)", () => {
    const { wrapper } = setup();
    renderHook(() => useReferralAssignees(false), { wrapper });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("useAssigneeSeesPartner", () => {
  it("checks whether the new owner can see the partner", async () => {
    rpcMock.mockResolvedValueOnce({ data: false, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useAssigneeSeesPartner("u-2", "p-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith("can_user_see_partner", { p_user_id: "u-2", p_partner_id: "p-1" });
    expect(result.current.data).toBe(false);
  });

  it("waits until both ids are known", () => {
    const { wrapper } = setup();
    renderHook(() => useAssigneeSeesPartner(null, "p-1"), { wrapper });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("useReassignReferral", () => {
  it("reassigns and refreshes every referrals query", async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null });
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useReassignReferral(), { wrapper });
    await expect(result.current.mutateAsync({ referralId: "r-1", userId: "u-2" })).resolves.toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("reassign_referral", { p_referral_id: "r-1", p_user_id: "u-2" });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ["referrals"] }));
  });

  it("turns a refusal into plain words", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "assignee_invalid" } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useReassignReferral(), { wrapper });
    await expect(result.current.mutateAsync({ referralId: "r-1", userId: "u-9" })).rejects.toThrow(
      "That teammate can't take this referral.",
    );
  });
});
