import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpcMock(...a) } }));
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) => selector({ user: { id: "user-1" } }),
}));

import { DEALS_QUERY_KEY } from "@/features/pipeline/hooks/useDeals";
import {
  useAcceptFormSubmission,
  useAttributeFormSubmission,
  useDeclineFormSubmission,
  useMergeFormSubmission,
  useReassignFormSubmission,
} from "./useFormSubmissionMutations";

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const spy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { wrapper, spy };
}

beforeEach(() => rpcMock.mockReset());

describe("form submission mutations", () => {
  it("attributes to a partner and returns the new referral id", async () => {
    rpcMock.mockResolvedValueOnce({ data: "r-new", error: null });
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useAttributeFormSubmission(), { wrapper });
    await expect(result.current.mutateAsync({ submissionId: "s-1", partnerId: "p-1" })).resolves.toBe("r-new");
    expect(rpcMock).toHaveBeenCalledWith("attribute_form_submission", { p_submission_id: "s-1", p_partner_id: "p-1" });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ["referrals"] }));
  });

  it("accepts with no partner, returns the deal id and refreshes deals and tasks", async () => {
    rpcMock.mockResolvedValueOnce({ data: "d-new", error: null });
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useAcceptFormSubmission(), { wrapper });
    await expect(result.current.mutateAsync("s-1")).resolves.toBe("d-new");
    expect(rpcMock).toHaveBeenCalledWith("accept_form_submission", { p_submission_id: "s-1" });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: DEALS_QUERY_KEY("user-1") }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["tasks", "user-1"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["referrals"] });
  });

  it("declines with a trimmed note, or none", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useDeclineFormSubmission(), { wrapper });
    await result.current.mutateAsync({ submissionId: "s-1", reason: "outside_icp", note: "  Too small " });
    expect(rpcMock).toHaveBeenLastCalledWith("decline_form_submission", { p_submission_id: "s-1", p_reason: "outside_icp", p_note: "Too small" });
    await result.current.mutateAsync({ submissionId: "s-1", reason: "duplicate", note: "  " });
    expect(rpcMock).toHaveBeenLastCalledWith("decline_form_submission", { p_submission_id: "s-1", p_reason: "duplicate", p_note: null });
  });

  it("merges into a deal and refreshes deals", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useMergeFormSubmission(), { wrapper });
    await result.current.mutateAsync({ submissionId: "s-1", dealId: "d-1" });
    expect(rpcMock).toHaveBeenCalledWith("merge_form_submission", { p_submission_id: "s-1", p_deal_id: "d-1" });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: DEALS_QUERY_KEY("user-1") }));
  });

  it("reassigns to a teammate", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useReassignFormSubmission(), { wrapper });
    await result.current.mutateAsync({ submissionId: "s-1", userId: "u-2" });
    expect(rpcMock).toHaveBeenCalledWith("reassign_form_submission", { p_submission_id: "s-1", p_user_id: "u-2" });
  });

  it("turns a server token into copy", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "submission_handled" } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useAcceptFormSubmission(), { wrapper });
    await expect(result.current.mutateAsync("s-1")).rejects.toThrow("This referral was already handled.");
  });
});
