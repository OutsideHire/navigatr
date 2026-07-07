// Coverage for ScheduleAppointmentSheet ("Two-way calendar sync, Milestone 1").
//
// The sheet composes a booking form (title/date/time/duration/location/notes),
// geocodes the location via the `geocode` Edge function (best-effort), and calls
// useScheduleAppointment().mutateAsync with the composed fields. Attendees are
// derived server-side at push time (sync_appointment), not here.
//
// We mock useScheduleAppointment + sonner, and stub the supabase geocode invoke.
// The Duration select is a Radix Select (portal), so we polyfill the
// jsdom-missing pointer/scroll APIs like SendReferralSheet.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import {
  ScheduleAppointmentSheet,
  type ScheduleAppointmentDeal,
} from "./ScheduleAppointmentSheet";

// ── Radix Select jsdom polyfills ───────────────────────────────────────────
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

const mutateAsyncSpy = vi.fn().mockResolvedValue({ id: "appt-1" });
vi.mock("@/features/appointments/useAppointments", () => ({
  useScheduleAppointment: () => ({ mutateAsync: mutateAsyncSpy, isPending: false }),
}));

// Geocode Edge function stub.
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke } },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const deal: ScheduleAppointmentDeal = {
  id: "deal-1",
  companyName: "Acme Hardware",
  address: "123 Main St, Springfield",
  email: "marcus@acmehardware.com",
};

function renderSheet(d: ScheduleAppointmentDeal = deal) {
  return render(
    <ScheduleAppointmentSheet open onOpenChange={() => {}} deal={d} />,
  );
}

describe("ScheduleAppointmentSheet", () => {
  beforeEach(() => {
    mutateAsyncSpy.mockClear();
    invoke.mockReset();
    invoke.mockResolvedValue({
      data: { result: { lat: 37.77, lng: -122.42, label: "123 Main St" } },
      error: null,
    });
  });

  it("defaults the title to the deal company and prefills the location", () => {
    renderSheet();
    expect(
      (screen.getByLabelText(/title/i) as HTMLInputElement).value,
    ).toBe("Appointment — Acme Hardware");
    expect(
      (screen.getByLabelText(/location/i) as HTMLInputElement).value,
    ).toBe("123 Main St, Springfield");
  });

  it("disables Schedule until date and time are both set", async () => {
    const user = userEvent.setup();
    renderSheet();
    const submit = screen.getByRole("button", { name: /^schedule$/i });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/date/i), "2026-07-10");
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/start time/i), "15:00");
    expect(submit).toBeEnabled();
  });

  it("submits composed ISO start/end + geocoded coords, with notes = only the rep's typed notes", async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText(/date/i), "2026-07-10");
    await user.type(screen.getByLabelText(/start time/i), "15:00");
    await user.type(
      screen.getByPlaceholderText(/add notes/i),
      "Bring the demo terminal",
    );

    await user.click(screen.getByRole("button", { name: /^schedule$/i }));

    await waitFor(() => expect(mutateAsyncSpy).toHaveBeenCalledTimes(1));
    const arg = mutateAsyncSpy.mock.calls[0][0];

    expect(arg.dealId).toBe("deal-1");
    expect(arg.title).toBe("Appointment — Acme Hardware");
    expect(arg.locationAddress).toBe("123 Main St, Springfield");
    // Geocode result flows through to lat/lng.
    expect(arg.locationLat).toBe(37.77);
    expect(arg.locationLng).toBe(-122.42);
    // Default 30-min duration: end is 30 minutes after start.
    const start = new Date(arg.startAt).getTime();
    const end = new Date(arg.endAt).getTime();
    expect(end - start).toBe(30 * 60_000);
    // Notes carry ONLY the rep's typed text — attendees are derived server-side
    // at push time (sync_appointment), never folded into notes here.
    expect(arg.notes).toBe("Bring the demo terminal");
    expect(arg.notes).not.toContain("marcus@acmehardware.com");
  });

  it("submits notes = null when the rep leaves notes empty", async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText(/date/i), "2026-07-10");
    await user.type(screen.getByLabelText(/start time/i), "15:00");
    await user.click(screen.getByRole("button", { name: /^schedule$/i }));

    await waitFor(() => expect(mutateAsyncSpy).toHaveBeenCalledTimes(1));
    expect(mutateAsyncSpy.mock.calls[0][0].notes).toBeNull();
  });

  it("geocodes via the `geocode` Edge function", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/date/i), "2026-07-10");
    await user.type(screen.getByLabelText(/start time/i), "09:30");
    await user.click(screen.getByRole("button", { name: /^schedule$/i }));

    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(invoke).toHaveBeenCalledWith("geocode", {
      body: { query: "123 Main St, Springfield" },
    });
  });

  it("submits with null coords when geocode misses", async () => {
    invoke.mockResolvedValue({ data: { result: null }, error: null });
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/date/i), "2026-07-10");
    await user.type(screen.getByLabelText(/start time/i), "09:30");
    await user.click(screen.getByRole("button", { name: /^schedule$/i }));

    await waitFor(() => expect(mutateAsyncSpy).toHaveBeenCalledTimes(1));
    const arg = mutateAsyncSpy.mock.calls[0][0];
    expect(arg.locationLat).toBeNull();
    expect(arg.locationLng).toBeNull();
  });
});
