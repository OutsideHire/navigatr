import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createElement } from "react";

import { useResetDemoData } from "./useResetDemoData";

let rpcResult: { error: { message: string } | null };
const rpcMock = vi.fn((..._args: unknown[]) => Promise.resolve(rpcResult));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: (...args: unknown[]) => rpcMock(...args) } }));

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

function client() {
  return new QueryClient({ defaultOptions: { mutations: { retry: false } } });
}

beforeEach(() => {
  rpcMock.mockClear();
});

describe("useResetDemoData", () => {
  it("calls reset_demo_data and clears the query client on success", async () => {
    rpcResult = { error: null };
    const c = client();
    const clearSpy = vi.spyOn(c, "clear");
    const { result } = renderHook(() => useResetDemoData(), { wrapper: wrapper(c) });
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith("reset_demo_data");
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects mutateAsync with the RPC error message", async () => {
    rpcResult = { error: { message: "demo_reset_not_enabled" } };
    const { result } = renderHook(() => useResetDemoData(), { wrapper: wrapper(client()) });
    await expect(result.current.mutateAsync()).rejects.toThrow("demo_reset_not_enabled");
  });
});
