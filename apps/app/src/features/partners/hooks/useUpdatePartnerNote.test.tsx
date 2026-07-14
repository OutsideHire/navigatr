import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useUpdatePartnerNote } from "./useUpdatePartnerNote";

const eqMock = vi.fn();
const updateMock = vi.fn(() => ({ eq: eqMock }));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ update: updateMock }) },
}));

let authUserId: string | undefined;
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: authUserId ? { id: authUserId } : null }),
}));

function makeWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  updateMock.mockClear();
  eqMock.mockReset();
  authUserId = "user-1";
});

describe("useUpdatePartnerNote", () => {
  it("updates body by id and invalidates ONLY the notes query", async () => {
    eqMock.mockResolvedValueOnce({ error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUpdatePartnerNote(), { wrapper: makeWrapper(client) });
    await result.current.mutateAsync({ noteId: "n-1", partnerId: "p-1", body: "Fixed text" });

    expect(updateMock).toHaveBeenCalledWith({ body: "Fixed text" });
    expect(eqMock).toHaveBeenCalledWith("id", "n-1");
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    const keys = invalidateSpy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(["partnerNotes", "byPartner", "user-1", "p-1"]);
    // Editing a note is not contact — the partners list must NOT be busted.
    expect(keys).not.toContainEqual(["partners", "list", "user-1"]);
  });

  it("refuses when not signed in", async () => {
    authUserId = undefined;
    const { result } = renderHook(() => useUpdatePartnerNote(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(
      result.current.mutateAsync({ noteId: "n-1", partnerId: "p-1", body: "x" }),
    ).rejects.toThrow(/not signed in/i);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("surfaces RLS / Supabase errors", async () => {
    eqMock.mockResolvedValueOnce({ error: { message: "row-level security" } });
    const { result } = renderHook(() => useUpdatePartnerNote(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(
      result.current.mutateAsync({ noteId: "n-1", partnerId: "p-1", body: "x" }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/row-level security/) });
  });
});
