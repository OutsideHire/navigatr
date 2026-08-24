import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  useConfirmEmailSuggestion,
  useDismissEmailSuggestion,
} from "./useEmailSuggestionActions";

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
});

describe("useConfirmEmailSuggestion", () => {
  it("calls confirm_email_suggestion with the id and returns the new activity id", async () => {
    rpcMock.mockResolvedValue({ data: "act-9", error: null });
    const { result } = renderHook(() => useConfirmEmailSuggestion(), { wrapper: wrapper() });
    result.current.mutate("e1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith("confirm_email_suggestion", { p_id: "e1" });
    expect(result.current.data).toBe("act-9");
  });

  it("invalidates the suggestions list and the activities lists on success", async () => {
    rpcMock.mockResolvedValue({ data: "act-9", error: null });
    const { result } = renderHook(() => useConfirmEmailSuggestion(), { wrapper: wrapper() });
    result.current.mutate("e1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["email-suggestions", "user-1"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["activities"] });
  });

  it("surfaces an RPC error to the caller", async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error("forbidden") });
    const { result } = renderHook(() => useConfirmEmailSuggestion(), { wrapper: wrapper() });
    result.current.mutate("e1");
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

describe("useDismissEmailSuggestion", () => {
  it("calls dismiss_email_suggestion with the id and invalidates only the suggestions list", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useDismissEmailSuggestion(), { wrapper: wrapper() });
    result.current.mutate("e1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith("dismiss_email_suggestion", { p_id: "e1" });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["email-suggestions", "user-1"] });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ["activities"] });
  });

  it("surfaces an RPC error to the caller", async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error("forbidden") });
    const { result } = renderHook(() => useDismissEmailSuggestion(), { wrapper: wrapper() });
    result.current.mutate("e1");
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
