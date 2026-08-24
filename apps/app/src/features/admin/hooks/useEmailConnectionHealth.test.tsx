import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEmailConnectionHealth } from "./useEmailConnectionHealth";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: "user-1" } }),
}));

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => rpcMock.mockReset());

describe("useEmailConnectionHealth", () => {
  it("calls the email_connection_health RPC and returns its rows", async () => {
    rpcMock.mockResolvedValue({
      data: [{ user_id: "u1", rep_name: "Jane", provider: "outlook", health: "ok", last_poll_at: null, capture_start_date: "x", last_error: null }],
      error: null,
    });
    const { result } = renderHook(() => useEmailConnectionHealth(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith("email_connection_health");
    expect(result.current.data).toHaveLength(1);
  });

  it("returns an empty array when the RPC returns null (non-admin)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useEmailConnectionHealth(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("surfaces an RPC error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error("boom") });
    const { result } = renderHook(() => useEmailConnectionHealth(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
