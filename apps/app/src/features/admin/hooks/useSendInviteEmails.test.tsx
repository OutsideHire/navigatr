// Covers invoke payload shape, result pass-through, and error surfacing.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useSendInviteEmails } from "./useSendInviteEmails";

const invokeMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invokeMock(...args) } },
}));

function makeWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe("useSendInviteEmails", () => {
  it("calls functions.invoke with { invite_ids } for the given input array", async () => {
    invokeMock.mockResolvedValueOnce({
      data: { results: [{ id: "abc", ok: true }] },
      error: null,
    });
    const { result } = renderHook(() => useSendInviteEmails(), {
      wrapper: makeWrapper(makeClient()),
    });
    await result.current.mutateAsync(["abc"]);
    expect(invokeMock).toHaveBeenCalledWith("send_invite_email", {
      body: { invite_ids: ["abc"] },
    });
  });

  it("returns the results array from the response (data.results)", async () => {
    const expected = [
      { id: "abc", ok: true },
      { id: "def", ok: false, error: "not_found" },
    ];
    invokeMock.mockResolvedValueOnce({
      data: { results: expected },
      error: null,
    });
    const { result } = renderHook(() => useSendInviteEmails(), {
      wrapper: makeWrapper(makeClient()),
    });
    const results = await result.current.mutateAsync(["abc", "def"]);
    expect(results).toEqual(expected);
  });

  it("surfaces errors when error is non-null in the response", async () => {
    invokeMock.mockResolvedValueOnce({
      data: null,
      error: { message: "edge function failed" },
    });
    const { result } = renderHook(() => useSendInviteEmails(), {
      wrapper: makeWrapper(makeClient()),
    });
    await expect(result.current.mutateAsync(["abc"])).rejects.toMatchObject({
      message: "edge function failed",
    });
  });
});
