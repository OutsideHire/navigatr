// Tests useRecordAppointmentOutcome: the mutation a rep fires after picking
// one of the nine appt_* outcomes on a past-due scheduled appointment.
//
// It composes the existing useLogActivity + useUpdateDeal hooks (mocked here,
// mirroring DropInSheet.test.tsx's style) rather than duplicating their SQL,
// then does its own scheduled_appointments UPDATE (mirroring the
// useCancelAppointment chainable-builder mock in useAppointments.test.tsx),
// fires syncFollowup fire-and-forget, and invalidates the appointments,
// deals, and activities caches on success.
//
// Write order is significant: the scheduled_appointments update and the
// stage effect are idempotent, so they run first; the appointment activity
// insert is NOT idempotent, so it runs last. That way a retry after a
// failure in an earlier step never double-inserts the activity. The
// "call order" and "does not log a duplicate activity" tests below pin
// that ordering down directly.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useRecordAppointmentOutcome } from "./useRecordAppointmentOutcome";
import { dealAppointmentsKey } from "../useAppointments";
import { DEALS_QUERY_KEY } from "@/features/pipeline/hooks/useDeals";
import { ACTIVITIES_QUERY_KEY, ACTIVITIES_ORG_QUERY_KEY } from "@/features/activities/hooks/useActivities";

// ---- shared call-order tracker (pins down the write ordering) ----
let callOrder: string[] = [];

// ---- composed-hook mocks ----
const logActivityMutateAsync = vi.fn().mockImplementation(async () => {
  callOrder.push("logActivity");
  return { id: "act-1" };
});
vi.mock("@/features/activities/hooks/useLogActivity", () => ({
  useLogActivity: () => ({ mutateAsync: logActivityMutateAsync }),
}));

const updateDealMutateAsync = vi.fn().mockImplementation(async () => {
  callOrder.push("updateDeal");
  return undefined;
});
vi.mock("@/features/pipeline/hooks/useUpdateDeal", () => ({
  useUpdateDeal: () => ({ mutateAsync: updateDealMutateAsync }),
}));

const syncFollowupMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../useFollowupSync", () => ({
  useFollowupSync: () => ({ syncFollowup: syncFollowupMock }),
}));

// ---- supabase mock for the scheduled_appointments UPDATE ----
const updateMock = vi.fn();
const eqMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      void table;
      const builder = {
        update: (...args: unknown[]) => {
          updateMock(...args);
          return builder;
        },
        eq: (...args: unknown[]) => {
          callOrder.push("appointmentUpdate");
          return eqMock(...args);
        },
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
  callOrder = [];
  logActivityMutateAsync.mockClear();
  updateDealMutateAsync.mockClear();
  syncFollowupMock.mockClear();
  updateMock.mockClear();
  eqMock.mockReset();
  eqMock.mockResolvedValue({ error: null });
  authUserId = "user-1";
});

describe("useRecordAppointmentOutcome", () => {
  it("logs an appointment activity with the outcome as disposition + a follow-up date", async () => {
    const { result } = renderHook(() => useRecordAppointmentOutcome(), { wrapper });
    await result.current.mutateAsync({
      appointmentId: "appt-1",
      dealId: "deal-1",
      outcome: "appt_presented_awaiting",
      notes: "Went well",
      hasFutureAppointment: false,
    });

    expect(logActivityMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        dealId: "deal-1",
        type: "appointment",
        disposition: "appt_presented_awaiting",
        outcomeNotes: "Went well",
        followUpDate: expect.any(String),
        voiceNoteUrl: null,
      }),
    );
  });

  it("passes a null follow-up date for appt_rescheduled when a future appointment already exists", async () => {
    const { result } = renderHook(() => useRecordAppointmentOutcome(), { wrapper });
    await result.current.mutateAsync({
      appointmentId: "appt-1",
      dealId: "deal-1",
      outcome: "appt_rescheduled",
      hasFutureAppointment: true,
    });

    expect(logActivityMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ disposition: "appt_rescheduled", followUpDate: null }),
    );
  });

  it("still schedules a follow-up for appt_rescheduled when no future appointment exists yet", async () => {
    const { result } = renderHook(() => useRecordAppointmentOutcome(), { wrapper });
    await result.current.mutateAsync({
      appointmentId: "appt-1",
      dealId: "deal-1",
      outcome: "appt_rescheduled",
      hasFutureAppointment: false,
    });

    expect(logActivityMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ disposition: "appt_rescheduled", followUpDate: expect.any(String) }),
    );
  });

  it("defaults outcomeNotes to empty string when notes are omitted", async () => {
    const { result } = renderHook(() => useRecordAppointmentOutcome(), { wrapper });
    await result.current.mutateAsync({
      appointmentId: "appt-1",
      dealId: "deal-1",
      outcome: "appt_no_show",
      hasFutureAppointment: false,
    });

    expect(logActivityMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ outcomeNotes: "" }),
    );
  });

  it("updates scheduled_appointments with outcome, outcome_notes, outcome_at, and status completed", async () => {
    const { result } = renderHook(() => useRecordAppointmentOutcome(), { wrapper });
    await result.current.mutateAsync({
      appointmentId: "appt-1",
      dealId: "deal-1",
      outcome: "appt_no_show",
      notes: "Merchant missed it",
      hasFutureAppointment: false,
    });

    expect(updateMock).toHaveBeenCalledTimes(1);
    const payload = (updateMock.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload.outcome).toBe("appt_no_show");
    expect(payload.outcome_notes).toBe("Merchant missed it");
    expect(payload.status).toBe("completed");
    expect(typeof payload.outcome_at).toBe("string");
    expect(eqMock).toHaveBeenCalledWith("id", "appt-1");
  });

  it("coalesces omitted notes to null in the scheduled_appointments update", async () => {
    const { result } = renderHook(() => useRecordAppointmentOutcome(), { wrapper });
    await result.current.mutateAsync({
      appointmentId: "appt-1",
      dealId: "deal-1",
      outcome: "appt_no_show",
      hasFutureAppointment: false,
    });
    const payload = (updateMock.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload.outcome_notes).toBeNull();
  });

  it("throws when the scheduled_appointments update fails, and does not log an activity (no double-log on retry)", async () => {
    eqMock.mockResolvedValueOnce({ error: { message: "update denied" } });
    const { result } = renderHook(() => useRecordAppointmentOutcome(), { wrapper });
    await expect(
      result.current.mutateAsync({
        appointmentId: "appt-1",
        dealId: "deal-1",
        outcome: "appt_no_show",
        hasFutureAppointment: false,
      }),
    ).rejects.toMatchObject({ message: "update denied" });

    // The activity insert is not idempotent, so it must never run when an
    // earlier (idempotent) write fails. A retry then re-runs the appointment
    // update as a no-op and inserts exactly one activity, instead of two.
    expect(logActivityMutateAsync).not.toHaveBeenCalled();
  });

  it("throws when the stage-effect update fails, and does not log an activity (no double-log on retry)", async () => {
    updateDealMutateAsync.mockRejectedValueOnce(new Error("stage update denied"));
    const { result } = renderHook(() => useRecordAppointmentOutcome(), { wrapper });
    await expect(
      result.current.mutateAsync({
        appointmentId: "appt-1",
        dealId: "deal-1",
        outcome: "appt_verbal_commitment",
        hasFutureAppointment: false,
      }),
    ).rejects.toThrow("stage update denied");

    expect(logActivityMutateAsync).not.toHaveBeenCalled();
  });

  it("runs the writes in order: appointment update, then stage effect, then the activity insert", async () => {
    const { result } = renderHook(() => useRecordAppointmentOutcome(), { wrapper });
    await result.current.mutateAsync({
      appointmentId: "appt-1",
      dealId: "deal-1",
      outcome: "appt_verbal_commitment",
      hasFutureAppointment: false,
    });

    expect(callOrder).toEqual(["appointmentUpdate", "updateDeal", "logActivity"]);
  });

  it("runs the appointment update before the activity insert even when there is no stage effect", async () => {
    const { result } = renderHook(() => useRecordAppointmentOutcome(), { wrapper });
    await result.current.mutateAsync({
      appointmentId: "appt-1",
      dealId: "deal-1",
      outcome: "appt_no_show",
      hasFutureAppointment: false,
    });

    expect(callOrder).toEqual(["appointmentUpdate", "logActivity"]);
  });

  it("advances the deal stage to proposal for appt_verbal_commitment", async () => {
    const { result } = renderHook(() => useRecordAppointmentOutcome(), { wrapper });
    await result.current.mutateAsync({
      appointmentId: "appt-1",
      dealId: "deal-1",
      outcome: "appt_verbal_commitment",
      hasFutureAppointment: false,
    });
    expect(updateDealMutateAsync).toHaveBeenCalledWith({
      id: "deal-1",
      patch: { stage: "proposal" },
    });
  });

  it("advances the deal stage to submitted for appt_application_signed", async () => {
    const { result } = renderHook(() => useRecordAppointmentOutcome(), { wrapper });
    await result.current.mutateAsync({
      appointmentId: "appt-1",
      dealId: "deal-1",
      outcome: "appt_application_signed",
      hasFutureAppointment: false,
    });
    expect(updateDealMutateAsync).toHaveBeenCalledWith({
      id: "deal-1",
      patch: { stage: "submitted" },
    });
  });

  it("moves the deal to lost for appt_not_interested + doNotContact", async () => {
    const { result } = renderHook(() => useRecordAppointmentOutcome(), { wrapper });
    await result.current.mutateAsync({
      appointmentId: "appt-1",
      dealId: "deal-1",
      outcome: "appt_not_interested",
      hasFutureAppointment: false,
      doNotContact: true,
    });
    expect(updateDealMutateAsync).toHaveBeenCalledWith({
      id: "deal-1",
      patch: { stage: "lost" },
    });
  });

  it("does NOT move the deal to lost for appt_not_interested without doNotContact", async () => {
    const { result } = renderHook(() => useRecordAppointmentOutcome(), { wrapper });
    await result.current.mutateAsync({
      appointmentId: "appt-1",
      dealId: "deal-1",
      outcome: "appt_not_interested",
      hasFutureAppointment: false,
      doNotContact: false,
    });
    expect(updateDealMutateAsync).not.toHaveBeenCalled();
  });

  it("does NOT update the deal stage for a neutral outcome like appt_no_show", async () => {
    const { result } = renderHook(() => useRecordAppointmentOutcome(), { wrapper });
    await result.current.mutateAsync({
      appointmentId: "appt-1",
      dealId: "deal-1",
      outcome: "appt_no_show",
      hasFutureAppointment: false,
    });
    expect(updateDealMutateAsync).not.toHaveBeenCalled();
  });

  it("fires syncFollowup for the deal (fire-and-forget)", async () => {
    const { result } = renderHook(() => useRecordAppointmentOutcome(), { wrapper });
    await result.current.mutateAsync({
      appointmentId: "appt-1",
      dealId: "deal-1",
      outcome: "appt_no_show",
      hasFutureAppointment: false,
    });
    await waitFor(() => expect(syncFollowupMock).toHaveBeenCalledWith("deal-1"));
  });

  it("invalidates the appointments, deals, and activities caches on success", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const localWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useRecordAppointmentOutcome(), { wrapper: localWrapper });
    await result.current.mutateAsync({
      appointmentId: "appt-1",
      dealId: "deal-1",
      outcome: "appt_no_show",
      hasFutureAppointment: false,
    });

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    const calledKeys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey);
    expect(calledKeys).toContainEqual(dealAppointmentsKey("deal-1"));
    expect(calledKeys).toContainEqual(DEALS_QUERY_KEY("user-1"));
    expect(calledKeys).toContainEqual(ACTIVITIES_QUERY_KEY("user-1", "deal-1"));
    expect(calledKeys).toContainEqual(ACTIVITIES_ORG_QUERY_KEY("user-1"));
  });
});
