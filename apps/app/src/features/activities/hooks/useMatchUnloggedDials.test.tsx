import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useMatchUnloggedDials } from "./useMatchUnloggedDials";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: "user-1" } }),
}));

let invalidateSpy: ReturnType<typeof vi.spyOn>;
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  invalidateSpy = vi.spyOn(client, "invalidateQueries");
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: 1, error: null });
});

describe("useMatchUnloggedDials", () => {
  it("calls match_unlogged_dials with the deal id and activity id", async () => {
    const { result } = renderHook(() => useMatchUnloggedDials(), { wrapper: wrapper() });
    result.current.mutate({ dealId: "deal-1", activityId: "act-1" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith("match_unlogged_dials", {
      p_deal_id: "deal-1",
      p_activity_id: "act-1",
    });
  });

  it("invalidates the unlogged-dials query key on success so the nudge refreshes", async () => {
    const { result } = renderHook(() => useMatchUnloggedDials(), { wrapper: wrapper() });
    result.current.mutate({ dealId: "deal-1", activityId: "act-1" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["coverage", "unlogged-dials", "user-1"],
    });
  });

  it("surfaces an RPC error to the caller", async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error("boom") });
    const { result } = renderHook(() => useMatchUnloggedDials(), { wrapper: wrapper() });
    result.current.mutate({ dealId: "deal-1", activityId: "act-1" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});
