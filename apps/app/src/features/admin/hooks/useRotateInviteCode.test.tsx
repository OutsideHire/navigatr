import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useRotateInviteCode } from "./useRotateInviteCode";

let rpcResult: { data: string | null; error: Error | null };
const rpcMock = vi.fn((..._args: unknown[]) => Promise.resolve(rpcResult));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: (...args: unknown[]) => rpcMock(...args) } }));

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function client() {
  return new QueryClient({ defaultOptions: { mutations: { retry: false } } });
}

beforeEach(() => { rpcResult = { data: "newcode1", error: null }; rpcMock.mockClear(); });

describe("useRotateInviteCode", () => {
  it("calls rotate_invite_code, returns the new code, and invalidates the organization query", async () => {
    const c = client();
    const invalidate = vi.spyOn(c, "invalidateQueries");
    const { result } = renderHook(() => useRotateInviteCode(), { wrapper: wrapper(c) });
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith("rotate_invite_code");
    expect(result.current.data).toBe("newcode1");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["organization"] });
  });

  it("surfaces an RPC error", async () => {
    rpcResult = { data: null, error: new Error("forbidden") };
    const { result } = renderHook(() => useRotateInviteCode(), { wrapper: wrapper(client()) });
    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual(new Error("forbidden"));
  });
});
