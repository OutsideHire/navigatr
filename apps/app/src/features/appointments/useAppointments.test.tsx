// Tests the scheduled_appointments data hooks: the list query (deal-scoped,
// non-cancelled, ordered) with row→camel mapping, and the schedule/cancel/retry
// mutations. Each mutation writes a row (or updates one) then best-effort
// invokes the sync_appointment Edge function — the invoke is fire-and-forget:
// a failing invoke must NOT fail the mutation, because the row is already
// persisted with calendar_sync_status='pending' and the UI reflects sync on
// refetch. RLS + the DB defaults (status='scheduled', calendar_sync_status=
// 'pending') are server-side concerns; here we confirm the hooks form the
// right Supabase calls and swallow invoke failures.
//
// Mirrors the chainable-builder mock in useDealContacts.test.tsx and the
// invoke + useAuth mocking style in useCalendarConnection.test.tsx. org_id is
// sourced from useProfile() (profile.data.org_id) exactly like useCreateDeal,
// so we mock @/features/auth/useProfile too.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  useDealAppointments,
  useScheduleAppointment,
  useCancelAppointment,
  useRetryAppointmentSync,
} from "./useAppointments";

// ---- supabase mock ----
// One chainable builder reused across all operations. Terminal methods (order/
// single) and the chainable eq/neq are vi.fns stubbed per-case. The list query
// chains .select().eq("deal_id").neq("status","cancelled").order("start_at");
// insert chains .select("id").single(); cancel chains .update().eq("id") as a
// terminal.
const orderMock = vi.fn();
const singleMock = vi.fn();
const selectMock = vi.fn();
const insertMock = vi.fn();
const updateMock = vi.fn();
const eqMock = vi.fn();
const neqMock = vi.fn();
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

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
        eq: (...args: unknown[]) => eqMock(...args) ?? builder,
        neq: (...args: unknown[]) => neqMock(...args) ?? builder,
        order: (...args: unknown[]) => orderMock(...args),
        single: (...args: unknown[]) => singleMock(...args),
      };
      return builder;
    },
    functions: { invoke },
  },
}));

let authUserId: string | undefined;
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: authUserId ? { id: authUserId } : null }),
}));

// org_id source of truth: useProfile().data.org_id (matches useCreateDeal).
let profileOrgId: string | undefined;
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({ data: profileOrgId ? { org_id: profileOrgId } : null }),
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
  eqMock.mockReset();
  neqMock.mockReset();
  invoke.mockReset();
  authUserId = "user-1";
  profileOrgId = "org-1";
});

// A complete row the way Supabase returns it, for exercising rowToAppointment.
const ROW = {
  id: "appt-1",
  deal_id: "deal-1",
  owner_id: "user-1",
  title: "Site visit — Sunset Cafe",
  start_at: "2026-07-10T15:00:00Z",
  end_at: "2026-07-10T16:00:00Z",
  location_address: "123 Main St",
  location_lat: 37.77,
  location_lng: -122.42,
  notes: "Bring the demo terminal",
  status: "scheduled",
  calendar_event_id: null,
  calendar_sync_status: "pending",
  calendar_sync_error: null,
  created_at: "2026-07-07T09:00:00Z",
  updated_at: "2026-07-07T09:00:00Z",
};

describe("useDealAppointments (list)", () => {
  it("selects deal-scoped, non-cancelled rows ordered by start_at asc and maps to camelCase", async () => {
    // eq → builder (so .neq chains), neq → builder (so .order chains), order → terminal.
    orderMock.mockResolvedValueOnce({ data: [ROW], error: null });

    const { result } = renderHook(() => useDealAppointments("deal-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(eqMock).toHaveBeenCalledWith("deal_id", "deal-1");
    // status <> 'cancelled' — expressed as a neq filter.
    expect(neqMock).toHaveBeenCalledWith("status", "cancelled");
    expect(orderMock).toHaveBeenCalledWith("start_at", { ascending: true });

    // Mapped shape: camelCase keys present.
    expect(result.current.data).toEqual([
      {
        id: "appt-1",
        dealId: "deal-1",
        ownerId: "user-1",
        title: "Site visit — Sunset Cafe",
        startAt: "2026-07-10T15:00:00Z",
        endAt: "2026-07-10T16:00:00Z",
        locationAddress: "123 Main St",
        locationLat: 37.77,
        locationLng: -122.42,
        notes: "Bring the demo terminal",
        status: "scheduled",
        calendarEventId: null,
        calendarSyncStatus: "pending",
        calendarSyncError: null,
        createdAt: "2026-07-07T09:00:00Z",
        updatedAt: "2026-07-07T09:00:00Z",
      },
    ]);
  });

  it("surfaces Supabase errors via isError", async () => {
    orderMock.mockResolvedValueOnce({
      data: null,
      error: { message: "permission denied for table scheduled_appointments" },
    });
    const { result } = renderHook(() => useDealAppointments("deal-1"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeTruthy();
  });

  it("stays disabled when dealId is empty (no query fired)", () => {
    const { result } = renderHook(() => useDealAppointments(""), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(orderMock).not.toHaveBeenCalled();
  });
});

describe("useScheduleAppointment", () => {
  it("inserts owner_id + org_id + the passed fields, then invokes sync_appointment upsert", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "appt-new" }, error: null });
    invoke.mockResolvedValueOnce({ data: { ok: true }, error: null });

    const { result } = renderHook(() => useScheduleAppointment(), { wrapper });
    const out = await result.current.mutateAsync({
      dealId: "deal-1",
      title: "Site visit",
      startAt: "2026-07-10T15:00:00Z",
      endAt: "2026-07-10T16:00:00Z",
      locationAddress: "123 Main St",
      locationLat: 37.77,
      locationLng: -122.42,
      notes: "warm",
    });

    expect(insertMock).toHaveBeenCalledTimes(1);
    const payload = (insertMock.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload).toEqual({
      owner_id: "user-1",
      org_id: "org-1",
      deal_id: "deal-1",
      title: "Site visit",
      start_at: "2026-07-10T15:00:00Z",
      end_at: "2026-07-10T16:00:00Z",
      location_address: "123 Main St",
      location_lat: 37.77,
      location_lng: -122.42,
      notes: "warm",
    });
    // Status / calendar_sync_status are DB defaults — the hook must NOT set them.
    expect(payload).not.toHaveProperty("status");
    expect(payload).not.toHaveProperty("calendar_sync_status");

    // Then it invokes the sync Edge function with the inserted id + upsert action.
    expect(invoke).toHaveBeenCalledWith("sync_appointment", {
      body: { appointment_id: "appt-new", action: "upsert" },
    });
    expect(out).toEqual({ id: "appt-new" });
  });

  it("coalesces omitted optional location/notes fields to null", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "appt-min" }, error: null });
    invoke.mockResolvedValueOnce({ data: { ok: true }, error: null });
    const { result } = renderHook(() => useScheduleAppointment(), { wrapper });
    await result.current.mutateAsync({
      dealId: "deal-1",
      title: "Quick call",
      startAt: "2026-07-10T15:00:00Z",
      endAt: "2026-07-10T15:30:00Z",
    });
    const payload = (insertMock.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      owner_id: "user-1",
      org_id: "org-1",
      deal_id: "deal-1",
      title: "Quick call",
      location_address: null,
      location_lat: null,
      location_lng: null,
      notes: null,
    });
  });

  it("does NOT reject when the sync invoke errors — the row is still created", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "appt-p" }, error: null });
    invoke.mockResolvedValueOnce({
      data: null,
      error: { message: "sync_appointment not deployed" },
    });
    const { result } = renderHook(() => useScheduleAppointment(), { wrapper });
    const out = await result.current.mutateAsync({
      dealId: "deal-1",
      title: "Site visit",
      startAt: "2026-07-10T15:00:00Z",
      endAt: "2026-07-10T16:00:00Z",
    });
    // Row still considered created; the mutation resolves with the id.
    expect(out).toEqual({ id: "appt-p" });
    expect(invoke).toHaveBeenCalledWith("sync_appointment", {
      body: { appointment_id: "appt-p", action: "upsert" },
    });
  });

  it("does NOT reject when the invoke itself throws (network) — row still created", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "appt-t" }, error: null });
    invoke.mockRejectedValueOnce(new Error("network down"));
    const { result } = renderHook(() => useScheduleAppointment(), { wrapper });
    const out = await result.current.mutateAsync({
      dealId: "deal-1",
      title: "Site visit",
      startAt: "2026-07-10T15:00:00Z",
      endAt: "2026-07-10T16:00:00Z",
    });
    expect(out).toEqual({ id: "appt-t" });
  });

  it("throws when the INSERT itself fails (no row created)", async () => {
    singleMock.mockResolvedValueOnce({
      data: null,
      error: { message: "new row violates row-level security policy" },
    });
    const { result } = renderHook(() => useScheduleAppointment(), { wrapper });
    await expect(
      result.current.mutateAsync({
        dealId: "deal-1",
        title: "X",
        startAt: "2026-07-10T15:00:00Z",
        endAt: "2026-07-10T16:00:00Z",
      }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/row-level security/) });
    // Insert failed → we never attempt the sync push.
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refuses to call Supabase when not signed in", async () => {
    authUserId = undefined;
    const { result } = renderHook(() => useScheduleAppointment(), { wrapper });
    await expect(
      result.current.mutateAsync({
        dealId: "deal-1",
        title: "X",
        startAt: "2026-07-10T15:00:00Z",
        endAt: "2026-07-10T16:00:00Z",
      }),
    ).rejects.toThrow(/not signed in/i);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("refuses to call Supabase when the profile (org_id) is not loaded", async () => {
    profileOrgId = undefined;
    const { result } = renderHook(() => useScheduleAppointment(), { wrapper });
    await expect(
      result.current.mutateAsync({
        dealId: "deal-1",
        title: "X",
        startAt: "2026-07-10T15:00:00Z",
        endAt: "2026-07-10T16:00:00Z",
      }),
    ).rejects.toThrow(/profile not loaded/i);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("invalidates the deal-appointments cache on success", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "appt-c" }, error: null });
    invoke.mockResolvedValueOnce({ data: { ok: true }, error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const localWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useScheduleAppointment(), { wrapper: localWrapper });
    await result.current.mutateAsync({
      dealId: "deal-1",
      title: "X",
      startAt: "2026-07-10T15:00:00Z",
      endAt: "2026-07-10T16:00:00Z",
    });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    expect(invalidateSpy.mock.calls[0][0]).toEqual({
      queryKey: ["appointments", "deal", "deal-1"],
    });
  });
});

describe("useCancelAppointment", () => {
  it("updates status='cancelled' by id then invokes sync_appointment delete", async () => {
    // update().eq("id", id) is terminal → eq resolves { error }.
    eqMock.mockResolvedValueOnce({ error: null });
    invoke.mockResolvedValueOnce({ data: { ok: true }, error: null });

    const { result } = renderHook(() => useCancelAppointment(), { wrapper });
    await result.current.mutateAsync({ id: "appt-1", dealId: "deal-1" });

    expect(updateMock).toHaveBeenCalledTimes(1);
    const payload = (updateMock.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload).toEqual({ status: "cancelled" });
    expect(eqMock).toHaveBeenCalledWith("id", "appt-1");
    expect(invoke).toHaveBeenCalledWith("sync_appointment", {
      body: { appointment_id: "appt-1", action: "delete" },
    });
  });

  it("does NOT reject when the sync delete invoke errors — the row is still cancelled", async () => {
    eqMock.mockResolvedValueOnce({ error: null });
    invoke.mockResolvedValueOnce({ data: null, error: { message: "not deployed" } });
    const { result } = renderHook(() => useCancelAppointment(), { wrapper });
    await expect(
      result.current.mutateAsync({ id: "appt-1", dealId: "deal-1" }),
    ).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("sync_appointment", {
      body: { appointment_id: "appt-1", action: "delete" },
    });
  });

  it("throws when the UPDATE itself fails", async () => {
    eqMock.mockResolvedValueOnce({ error: { message: "update denied" } });
    const { result } = renderHook(() => useCancelAppointment(), { wrapper });
    await expect(
      result.current.mutateAsync({ id: "appt-1", dealId: "deal-1" }),
    ).rejects.toMatchObject({ message: "update denied" });
    // Update failed → no sync push.
    expect(invoke).not.toHaveBeenCalled();
  });

  it("invalidates the deal-appointments cache on success", async () => {
    eqMock.mockResolvedValueOnce({ error: null });
    invoke.mockResolvedValueOnce({ data: { ok: true }, error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const localWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useCancelAppointment(), { wrapper: localWrapper });
    await result.current.mutateAsync({ id: "appt-1", dealId: "deal-1" });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    expect(invalidateSpy.mock.calls[0][0]).toEqual({
      queryKey: ["appointments", "deal", "deal-1"],
    });
  });
});

describe("useRetryAppointmentSync", () => {
  it("invokes sync_appointment upsert and invalidates the deal query", async () => {
    invoke.mockResolvedValueOnce({ data: { ok: true }, error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const localWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useRetryAppointmentSync(), { wrapper: localWrapper });
    await result.current.mutateAsync({ id: "appt-1", dealId: "deal-1" });

    expect(invoke).toHaveBeenCalledWith("sync_appointment", {
      body: { appointment_id: "appt-1", action: "upsert" },
    });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    expect(invalidateSpy.mock.calls[0][0]).toEqual({
      queryKey: ["appointments", "deal", "deal-1"],
    });
  });

  it("does NOT reject when the retry invoke errors (still fire-and-forget)", async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: "still down" } });
    const { result } = renderHook(() => useRetryAppointmentSync(), { wrapper });
    await expect(
      result.current.mutateAsync({ id: "appt-1", dealId: "deal-1" }),
    ).resolves.toBeUndefined();
  });
});
