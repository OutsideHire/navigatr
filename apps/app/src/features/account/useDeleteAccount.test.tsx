// useDeleteAccount — RPC name + payload shape, sign-out + redirect on
// success, error pass-through.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { ReactNode } from "react";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

const signOutMock = vi.fn(() => Promise.resolve());
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { signOut: () => Promise<void> }) => unknown) =>
    selector({ signOut: signOutMock }),
}));

import { useDeleteAccount } from "./useDeleteAccount";

function makeWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/settings"]}>
        <Routes>
          <Route path="/settings" element={<>{children}</>} />
          <Route path="/login" element={<div>login page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function freshClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

beforeEach(() => {
  rpcMock.mockReset();
  signOutMock.mockClear();
});

describe("useDeleteAccount", () => {
  it("calls request_account_deletion RPC with no arguments", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ status: "anonymized", anonymized_at: "2026-05-29T13:00:00Z" }],
      error: null,
    });
    const { result } = renderHook(() => useDeleteAccount(), {
      wrapper: makeWrapper(freshClient()),
    });
    await result.current.mutateAsync();
    expect(rpcMock).toHaveBeenCalledWith("request_account_deletion");
  });

  it("returns the RPC row verbatim on success", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ status: "anonymized", anonymized_at: "2026-05-29T13:00:00Z" }],
      error: null,
    });
    const { result } = renderHook(() => useDeleteAccount(), {
      wrapper: makeWrapper(freshClient()),
    });
    const out = await result.current.mutateAsync();
    expect(out.status).toBe("anonymized");
    expect(out.anonymized_at).toBe("2026-05-29T13:00:00Z");
  });

  it("calls signOut after successful anonymization", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ status: "anonymized", anonymized_at: "2026-05-29T13:00:00Z" }],
      error: null,
    });
    const { result } = renderHook(() => useDeleteAccount(), {
      wrapper: makeWrapper(freshClient()),
    });
    await result.current.mutateAsync();
    await waitFor(() => expect(signOutMock).toHaveBeenCalledTimes(1));
  });

  it("surfaces RPC errors and does NOT sign the user out", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "not_authenticated" },
    });
    const { result } = renderHook(() => useDeleteAccount(), {
      wrapper: makeWrapper(freshClient()),
    });
    await expect(result.current.mutateAsync()).rejects.toThrow("not_authenticated");
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("handles non-array RPC return (some plpgsql shapes return a single row, not table)", async () => {
    rpcMock.mockResolvedValueOnce({
      data: { status: "no_profile", anonymized_at: "2026-05-29T13:00:00Z" },
      error: null,
    });
    const { result } = renderHook(() => useDeleteAccount(), {
      wrapper: makeWrapper(freshClient()),
    });
    const out = await result.current.mutateAsync();
    expect(out.status).toBe("no_profile");
  });

  it("still signs out even if sign-out throws (defensive)", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ status: "anonymized", anonymized_at: "2026-05-29T13:00:00Z" }],
      error: null,
    });
    signOutMock.mockRejectedValueOnce(new Error("stale jwt"));
    const { result } = renderHook(() => useDeleteAccount(), {
      wrapper: makeWrapper(freshClient()),
    });
    // The hook swallows sign-out errors so the user still gets redirected.
    await expect(result.current.mutateAsync()).resolves.toBeDefined();
  });
});
