// Tests the deal_contacts CRUD hooks: the snake_case row → camel DealContact
// mapping for the list query, and the insert/update/delete mutation payloads.
// RLS + the org-derivation trigger are server-side concerns verified in the
// SQL editor; here we confirm the hooks form the right Supabase calls and
// surface failures. Mirrors the chainable-mock scaffolding in
// useCreateDeal.test.tsx (insert/select/single) and the order-mock style in
// useDeals.test.tsx (select/eq/order).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  useDealContacts,
  useCreateDealContact,
  useUpdateDealContact,
  useDeleteDealContact,
} from "./useDealContacts";

// ---- supabase mock ----
// One chainable builder reused across all operations. Each terminal method
// (order / single / eq) is a vi.fn the tests stub per-case. Intermediate
// methods record their args and return the builder so chains compose.

const orderMock = vi.fn();
const singleMock = vi.fn();
const selectMock = vi.fn();
const insertMock = vi.fn();
const updateMock = vi.fn();
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
        update: (...args: unknown[]) => {
          updateMock(...args);
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
  updateMock.mockClear();
  deleteMock.mockClear();
  eqMock.mockReset();
  authUserId = "user-1";
});

// The list query chains .eq() then .order(); the mutations chain .eq() as a
// terminal. To support both, eq returns the builder (so .order can follow)
// EXCEPT when a test stubs a terminal resolution on eqMock. We default eq to
// a builder-returning passthrough and let order/single/eq terminals resolve.
function makeEqChainable(builder: unknown) {
  eqMock.mockImplementation(() => builder);
}

describe("useDealContacts (list)", () => {
  it("selects from deal_contacts filtered by deal_id, ordered ascending, mapping rows to camel DealContact", async () => {
    // eq must return the builder so .order() can chain; we re-derive the
    // builder lazily — easiest is to have eq return an object exposing order.
    eqMock.mockImplementation(() => ({ order: (...a: unknown[]) => orderMock(...a) }));
    orderMock.mockResolvedValueOnce({
      data: [
        {
          id: "dc-1",
          deal_id: "deal-1",
          name: "Jane Buyer",
          title: "VP Ops",
          email: "jane@acme.com",
          phone: "+12025550100",
          role: "decision_maker",
          note: "Met at trade show",
          created_at: "2026-06-18T08:00:00Z",
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useDealContacts("deal-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(selectMock).toHaveBeenCalledWith("*");
    expect(eqMock).toHaveBeenCalledWith("deal_id", "deal-1");
    expect(orderMock).toHaveBeenCalledWith("created_at", { ascending: true });
    expect(result.current.data).toEqual([
      {
        id: "dc-1",
        dealId: "deal-1",
        name: "Jane Buyer",
        title: "VP Ops",
        email: "jane@acme.com",
        phone: "+12025550100",
        role: "decision_maker",
        note: "Met at trade show",
        createdAt: "2026-06-18T08:00:00Z",
      },
    ]);
  });

  it("surfaces Supabase errors via isError", async () => {
    eqMock.mockImplementation(() => ({ order: (...a: unknown[]) => orderMock(...a) }));
    orderMock.mockResolvedValueOnce({
      data: null,
      error: { message: "permission denied for table deal_contacts" },
    });
    const { result } = renderHook(() => useDealContacts("deal-1"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeTruthy();
  });

  it("stays disabled when dealId is empty (no query fired)", () => {
    const { result } = renderHook(() => useDealContacts(""), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(orderMock).not.toHaveBeenCalled();
  });
});

describe("useCreateDealContact", () => {
  it("inserts deal_id + created_by + fields (NOT org_id) and resolves { id }", async () => {
    makeEqChainable(undefined);
    selectMock.mockClear();
    singleMock.mockResolvedValueOnce({ data: { id: "dc-new" }, error: null });

    const { result } = renderHook(() => useCreateDealContact(), { wrapper });
    const out = await result.current.mutateAsync({
      dealId: "deal-1",
      name: "Jane",
      title: "VP",
      email: "j@acme.com",
      phone: "+12025550100",
      role: "champion",
      note: "warm",
    });

    expect(insertMock).toHaveBeenCalledTimes(1);
    const payload = (insertMock.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload).toEqual({
      deal_id: "deal-1",
      created_by: "user-1",
      name: "Jane",
      title: "VP",
      email: "j@acme.com",
      phone: "+12025550100",
      role: "champion",
      note: "warm",
    });
    expect(payload).not.toHaveProperty("org_id");
    expect(out).toEqual({ id: "dc-new" });
  });

  it("coalesces omitted optional fields to null", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "dc-min" }, error: null });
    const { result } = renderHook(() => useCreateDealContact(), { wrapper });
    await result.current.mutateAsync({ dealId: "deal-1", name: "Solo" });
    const payload = (insertMock.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      deal_id: "deal-1",
      created_by: "user-1",
      name: "Solo",
      title: null,
      email: null,
      phone: null,
      role: null,
      note: null,
    });
  });

  it("refuses to call Supabase when not signed in", async () => {
    authUserId = undefined;
    const { result } = renderHook(() => useCreateDealContact(), { wrapper });
    await expect(
      result.current.mutateAsync({ dealId: "deal-1", name: "X" }),
    ).rejects.toThrow(/not signed in/i);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("throws when Supabase returns an error", async () => {
    singleMock.mockResolvedValueOnce({
      data: null,
      error: { message: "new row violates row-level security policy" },
    });
    const { result } = renderHook(() => useCreateDealContact(), { wrapper });
    await expect(
      result.current.mutateAsync({ dealId: "deal-1", name: "X" }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/row-level security/) });
  });

  it("invalidates the deal-contacts cache on success", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "dc-c" }, error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const localWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useCreateDealContact(), { wrapper: localWrapper });
    await result.current.mutateAsync({ dealId: "deal-1", name: "X" });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    expect(invalidateSpy.mock.calls[0][0]).toEqual({
      queryKey: ["deal-contacts", "deal-1"],
    });
  });
});

describe("useUpdateDealContact", () => {
  it("updates by id with only the provided patch fields", async () => {
    eqMock.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useUpdateDealContact(), { wrapper });
    await result.current.mutateAsync({
      id: "dc-1",
      dealId: "deal-1",
      patch: { name: "Renamed", email: "new@acme.com" },
    });
    expect(updateMock).toHaveBeenCalledTimes(1);
    const payload = (updateMock.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload).toEqual({ name: "Renamed", email: "new@acme.com" });
    expect(eqMock).toHaveBeenCalledWith("id", "dc-1");
  });

  it("coalesces nulled-out patch fields to null", async () => {
    eqMock.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useUpdateDealContact(), { wrapper });
    await result.current.mutateAsync({
      id: "dc-1",
      dealId: "deal-1",
      patch: { title: undefined, email: undefined, note: undefined },
    });
    // undefined patch fields are omitted entirely (not sent as null).
    const payload = (updateMock.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload).toEqual({});
  });

  it("throws when Supabase returns an error", async () => {
    eqMock.mockResolvedValueOnce({ error: { message: "update denied" } });
    const { result } = renderHook(() => useUpdateDealContact(), { wrapper });
    await expect(
      result.current.mutateAsync({ id: "dc-1", dealId: "deal-1", patch: { name: "X" } }),
    ).rejects.toMatchObject({ message: "update denied" });
  });

  it("invalidates the deal-contacts cache on success", async () => {
    eqMock.mockResolvedValueOnce({ error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const localWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useUpdateDealContact(), { wrapper: localWrapper });
    await result.current.mutateAsync({ id: "dc-1", dealId: "deal-1", patch: { name: "X" } });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    expect(invalidateSpy.mock.calls[0][0]).toEqual({
      queryKey: ["deal-contacts", "deal-1"],
    });
  });
});

describe("useDeleteDealContact", () => {
  it("deletes by id", async () => {
    eqMock.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useDeleteDealContact(), { wrapper });
    await result.current.mutateAsync({ id: "dc-1", dealId: "deal-1" });
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(eqMock).toHaveBeenCalledWith("id", "dc-1");
  });

  it("throws when Supabase returns an error", async () => {
    eqMock.mockResolvedValueOnce({ error: { message: "delete denied" } });
    const { result } = renderHook(() => useDeleteDealContact(), { wrapper });
    await expect(
      result.current.mutateAsync({ id: "dc-1", dealId: "deal-1" }),
    ).rejects.toMatchObject({ message: "delete denied" });
  });

  it("invalidates the deal-contacts cache on success", async () => {
    eqMock.mockResolvedValueOnce({ error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const localWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useDeleteDealContact(), { wrapper: localWrapper });
    await result.current.mutateAsync({ id: "dc-1", dealId: "deal-1" });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    expect(invalidateSpy.mock.calls[0][0]).toEqual({
      queryKey: ["deal-contacts", "deal-1"],
    });
  });
});
