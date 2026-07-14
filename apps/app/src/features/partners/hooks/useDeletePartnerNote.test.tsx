import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useDeletePartnerNote } from "./useDeletePartnerNote";

const eqMock = vi.fn();
const deleteMock = vi.fn(() => ({ eq: eqMock }));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ delete: deleteMock }) },
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
  deleteMock.mockClear();
  eqMock.mockReset();
  authUserId = "user-1";
});

describe("useDeletePartnerNote", () => {
  it("deletes by id and invalidates the partner's notes query", async () => {
    eqMock.mockResolvedValueOnce({ error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useDeletePartnerNote(), { wrapper: makeWrapper(client) });
    await result.current.mutateAsync({ noteId: "n-1", partnerId: "p-1" });

    expect(eqMock).toHaveBeenCalledWith("id", "n-1");
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    const keys = invalidateSpy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(["partnerNotes", "byPartner", "user-1", "p-1"]);
  });

  it("surfaces RLS / Supabase errors", async () => {
    eqMock.mockResolvedValueOnce({ error: { message: "row-level security" } });
    const { result } = renderHook(() => useDeletePartnerNote(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(
      result.current.mutateAsync({ noteId: "n-1", partnerId: "p-1" }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/row-level security/) });
  });
});
