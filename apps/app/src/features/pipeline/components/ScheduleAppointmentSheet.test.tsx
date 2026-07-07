// Coverage for ScheduleAppointmentSheet ("Two-way calendar sync, Milestone 1").
//
// The sheet composes a booking form (title/date/time/duration/location/notes),
// geocodes the location via the `geocode` Edge function (best-effort), gathers
// attendee emails (deal primary + deal-contact emails), and calls
// useScheduleAppointment().mutateAsync with the composed fields.
//
// We mock useScheduleAppointment + useDealContacts + sonner, and stub the
// supabase geocode invoke. The Duration select is a Radix Select (portal), so
// we polyfill the jsdom-missing pointer/scroll APIs like SendReferralSheet.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import {
  ScheduleAppointmentSheet,
  collectAttendeeEmails,
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

// Deal-contact emails contributed as attendees.
let contactsData: Array<{ email: string | null }> = [];
vi.mock("../hooks/useDealContacts", () => ({
  useDealContacts: () => ({ data: contactsData }),
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

describe("collectAttendeeEmails", () => {
  it("dedups, trims, and drops empties; includes the primary first", () => {
    expect(
      collectAttendeeEmails("  a@x.com ", ["b@x.com", "", null, "a@x.com"]),
    ).toEqual(["a@x.com", "b@x.com"]);
  });

  it("returns [] when nothing is present", () => {
    expect(collectAttendeeEmails(null, [undefined, ""])).toEqual([]);
  });
});

describe("ScheduleAppointmentSheet", () => {
  beforeEach(() => {
    mutateAsyncSpy.mockClear();
    invoke.mockReset();
    invoke.mockResolvedValue({
      data: { result: { lat: 37.77, lng: -122.42, label: "123 Main St" } },
      error: null,
    });
    contactsData = [];
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

  it("submits composed ISO start/end, geocoded coords, and attendee emails in notes", async () => {
    const user = userEvent.setup();
    contactsData = [{ email: "cfo@acmehardware.com" }];
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
    // Attendee emails (deal primary + deal contact) folded into notes.
    expect(arg.notes).toContain("Bring the demo terminal");
    expect(arg.notes).toContain("marcus@acmehardware.com");
    expect(arg.notes).toContain("cfo@acmehardware.com");
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
