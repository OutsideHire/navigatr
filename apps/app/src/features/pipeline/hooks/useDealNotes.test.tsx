// Tests the deal_notes CRUD hooks: the snake_case row → camel DealNote mapping
// for the list query (ordered created_at descending), and the insert/delete
// mutation payloads. RLS + the org-derivation trigger are server-side concerns
// verified in the SQL editor; here we confirm the hooks form the right
// Supabase calls and surface failures. Mirrors the chainable-builder mock in
// useDealContacts.test.tsx (one builder, terminal vi.fns stubbed per case).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  useDealNotes,
  useCreateDealNote,
  useDeleteDealNote,
} from "./useDealNotes";

// ---- supabase mock ----
// One chainable builder reused across all operations. Each terminal method
// (order / single / eq) is a vi.fn the tests stub per-case. Intermediate
// methods record their args and return the builder so chains compose.

const orderMock = vi.fn();
const singleMock = vi.fn();
const selectMock = vi.fn();
const insertMock = vi.fn();
const deleteMock = vi.fn();
const eqMock = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      void table;
      const builder = {
        select: (...args: unknown[]) => {
          selectMock(...args);
          return builder;
        },
        insert: (...args: unknown[]) => {
          insertMock(...args);
          return builder;
        },
        delete: (...args: unknown[]) => {
          deleteMock(...args);
          return builder;
        },
        eq: (...args: unknown[]) => eqMock(...args) ?? builder,
        order: (...args: unknown[]) => orderMock(...args),
        single: (...args: unknown[]) => singleMock(...args),
      };
      return builder;
    },
  },
}));

let authUserId: string | undefined;
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: authUserId ? { id: authUserId } : null }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  orderMock.mockReset();
  singleMock.mockReset();
  selectMock.mockClear();
  insertMock.mockClear();
  deleteMock.mockClear();
  eqMock.mockReset();
  authUserId = "user-1";
});

// The list query chains .eq() then .order(); the delete mutation chains .eq()
// as a terminal. To support both, eq returns the builder (so .order can
// follow) EXCEPT when a test stubs a terminal resolution on eqMock.
function makeEqChainable(builder: unknown) {
  eqMock.mockImplementation(() => builder);
}

describe("useDealNotes (list)", () => {
  it("selects from deal_notes filtered by deal_id, ordered descending, mapping rows to camel DealNote", async () => {
    eqMock.mockImplementation(() => ({ order: (...a: unknown[]) => orderMock(...a) }));
    orderMock.mockResolvedValueOnce({
      data: [
        {
          id: "dn-1",
          deal_id: "deal-1",
          body: "Called the buyer, sending proposal Monday.",
          created_by: "user-1",
          created_at: "2026-06-18T08:00:00Z",
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useDealNotes("deal-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(selectMock).toHaveBeenCalledWith("*");
    expect(eqMock).toHaveBeenCalledWith("deal_id", "deal-1");
    expect(orderMock).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(result.current.data).toEqual([
      {
        id: "dn-1",
        dealId: "deal-1",
        body: "Called the buyer, sending proposal Monday.",
        createdBy: "user-1",
        createdAt: "2026-06-18T08:00:00Z",
      },
    ]);
  });

  it("surfaces Supabase errors via isError", async () => {
    eqMock.mockImplementation(() => ({ order: (...a: unknown[]) => orderMock(...a) }));
    orderMock.mockResolvedValueOnce({
      data: null,
      error: { message: "permission denied for table deal_notes" },
    });
    const { result } = renderHook(() => useDealNotes("deal-1"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeTruthy();
  });

  it("stays disabled when dealId is empty (no query fired)", () => {
    const { result } = renderHook(() => useDealNotes(""), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(orderMock).not.toHaveBeenCalled();
  });
});

describe("useCreateDealNote", () => {
  it("inserts deal_id + created_by + body (NOT org_id) and resolves { id }", async () => {
    makeEqChainable(undefined);
    selectMock.mockClear();
    singleMock.mockResolvedValueOnce({ data: { id: "dn-new" }, error: null });

    const { result } = renderHook(() => useCreateDealNote(), { wrapper });
    const out = await result.current.mutateAsync({
      dealId: "deal-1",
      body: "Follow up next week.",
    });

    expect(insertMock).toHaveBeenCalledTimes(1);
    const payload = (insertMock.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload).toEqual({
      deal_id: "deal-1",
      created_by: "user-1",
      body: "Follow up next week.",
    });
    expect(payload).not.toHaveProperty("org_id");
    expect(out).toEqual({ id: "dn-new" });
  });

  it("refuses to call Supabase when not signed in", async () => {
    authUserId = undefined;
    const { result } = renderHook(() => useCreateDealNote(), { wrapper });
    await expect(
      result.current.mutateAsync({ dealId: "deal-1", body: "X" }),
    ).rejects.toThrow(/not signed in/i);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("throws when Supabase returns an error", async () => {
    singleMock.mockResolvedValueOnce({
      data: null,
      error: { message: "new row violates row-level security policy" },
    });
    const { result } = renderHook(() => useCreateDealNote(), { wrapper });
    await expect(
      result.current.mutateAsync({ dealId: "deal-1", body: "X" }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/row-level security/) });
  });

  it("invalidates the deal-notes cache on success", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "dn-c" }, error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const localWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useCreateDealNote(), { wrapper: localWrapper });
    await result.current.mutateAsync({ dealId: "deal-1", body: "X" });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    expect(invalidateSpy.mock.calls[0][0]).toEqual({
      queryKey: ["deal-notes", "deal-1"],
    });
  });
});

describe("useDeleteDealNote", () => {
  it("deletes by id", async () => {
    eqMock.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useDeleteDealNote(), { wrapper });
    await result.current.mutateAsync({ id: "dn-1", dealId: "deal-1" });
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(eqMock).toHaveBeenCalledWith("id", "dn-1");
  });

  it("throws when Supabase returns an error", async () => {
    eqMock.mockResolvedValueOnce({ error: { message: "delete denied" } });
    const { result } = renderHook(() => useDeleteDealNote(), { wrapper });
    await expect(
      result.current.mutateAsync({ id: "dn-1", dealId: "deal-1" }),
    ).rejects.toMatchObject({ message: "delete denied" });
  });

  it("invalidates the deal-notes cache on success", async () => {
    eqMock.mockResolvedValueOnce({ error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const localWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useDeleteDealNote(), { wrapper: localWrapper });
    await result.current.mutateAsync({ id: "dn-1", dealId: "deal-1" });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    expect(invalidateSpy.mock.calls[0][0]).toEqual({
      queryKey: ["deal-notes", "deal-1"],
    });
  });
});
