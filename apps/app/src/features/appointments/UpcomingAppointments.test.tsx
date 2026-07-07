// Tests UpcomingAppointments — the Deal Detail right-rail list of booked
// appointments. The data hooks (useAppointments) are mocked so these tests are
// pure render/interaction checks: one row per appointment (time + title +
// location), the sync badge per calendarSyncStatus, a Retry button on errored
// rows that calls retry with { id, dealId }, a Cancel button that calls cancel
// with { id, dealId }, and nothing rendered for an empty list.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { UpcomingAppointments } from "./UpcomingAppointments";
import type { ScheduledAppointment } from "./types";

// ---- useAppointments mock ----
// useDealAppointments returns whatever `listData` we set per-case; the cancel/
// retry mutations expose vi.fn() `mutate` spies so we can assert the args.
const { listData, cancelMutate, retryMutate } = vi.hoisted(() => ({
  listData: { current: [] as ScheduledAppointment[] },
  cancelMutate: vi.fn(),
  retryMutate: vi.fn(),
}));

vi.mock("./useAppointments", () => ({
  useDealAppointments: () => ({ data: listData.current }),
  useCancelAppointment: () => ({ mutate: cancelMutate, isPending: false }),
  useRetryAppointmentSync: () => ({ mutate: retryMutate, isPending: false }),
}));

function makeAppt(overrides: Partial<ScheduledAppointment> = {}): ScheduledAppointment {
  return {
    id: "appt-1",
    dealId: "deal-1",
    ownerId: "user-1",
    title: "Site visit — Sunset Cafe",
    startAt: "2026-07-10T17:00:00Z",
    endAt: "2026-07-10T18:00:00Z",
    locationAddress: "123 Main St",
    locationLat: null,
    locationLng: null,
    notes: null,
    status: "scheduled",
    calendarEventId: null,
    calendarSyncStatus: "pending",
    calendarSyncError: null,
    createdAt: "2026-07-07T09:00:00Z",
    updatedAt: "2026-07-07T09:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  listData.current = [];
  cancelMutate.mockReset();
  retryMutate.mockReset();
});

describe("UpcomingAppointments", () => {
  it("renders one row per appointment with title, time, and location", () => {
    listData.current = [
      makeAppt({ id: "a1", title: "Site visit", locationAddress: "123 Main St", startAt: "2026-07-10T17:00:00Z" }),
      makeAppt({ id: "a2", title: "Follow-up call", locationAddress: null, calendarSyncStatus: "synced", startAt: "2026-07-11T20:30:00Z" }),
    ];
    render(<UpcomingAppointments dealId="deal-1" />);

    // A row per appointment: both titles present.
    expect(screen.getByText("Site visit")).toBeInTheDocument();
    expect(screen.getByText("Follow-up call")).toBeInTheDocument();

    // Location shows when present, absent when null.
    expect(screen.getByText("123 Main St")).toBeInTheDocument();

    // Time rendered in the viewer's locale/timezone via toLocaleString — assert
    // the same formatting the component uses so this isn't timezone-brittle.
    const expected = new Date("2026-07-10T17:00:00Z").toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("shows 'On calendar' for a synced appointment", () => {
    listData.current = [makeAppt({ calendarSyncStatus: "synced" })];
    render(<UpcomingAppointments dealId="deal-1" />);
    expect(screen.getByText("On calendar")).toBeInTheDocument();
    // No retry offered for a healthy sync.
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("shows 'Syncing…' for a pending appointment", () => {
    listData.current = [makeAppt({ calendarSyncStatus: "pending" })];
    render(<UpcomingAppointments dealId="deal-1" />);
    expect(screen.getByText("Syncing…")).toBeInTheDocument();
  });

  it("shows 'Not synced' + a Retry button for an errored appointment; Retry calls retry with { id, dealId }", async () => {
    const user = userEvent.setup();
    listData.current = [
      makeAppt({ id: "appt-err", dealId: "deal-9", calendarSyncStatus: "error" }),
    ];
    render(<UpcomingAppointments dealId="deal-9" />);

    expect(screen.getByText("Not synced")).toBeInTheDocument();
    const retryBtn = screen.getByRole("button", { name: /retry/i });
    await user.click(retryBtn);
    expect(retryMutate).toHaveBeenCalledWith({ id: "appt-err", dealId: "deal-9" });
  });

  it("Cancel calls cancel with { id, dealId }", async () => {
    const user = userEvent.setup();
    listData.current = [makeAppt({ id: "appt-c", dealId: "deal-7" })];
    render(<UpcomingAppointments dealId="deal-7" />);

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(cancelMutate).toHaveBeenCalledWith({ id: "appt-c", dealId: "deal-7" });
  });

  it("renders no appointment rows for an empty list", () => {
    listData.current = [];
    const { container } = render(<UpcomingAppointments dealId="deal-1" />);
    // Empty state renders nothing — no Cancel/Retry buttons, no card heading.
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
  });

  it("scopes Cancel/Retry to the row they belong to", async () => {
    const user = userEvent.setup();
    listData.current = [
      makeAppt({ id: "ok", calendarSyncStatus: "synced", title: "Good one" }),
      makeAppt({ id: "bad", dealId: "deal-1", calendarSyncStatus: "error", title: "Broken one" }),
    ];
    render(<UpcomingAppointments dealId="deal-1" />);

    // Only the errored row exposes Retry.
    const retryButtons = screen.getAllByRole("button", { name: /retry/i });
    expect(retryButtons).toHaveLength(1);
    await user.click(retryButtons[0]);
    expect(retryMutate).toHaveBeenCalledWith({ id: "bad", dealId: "deal-1" });

    // Both rows expose Cancel.
    expect(screen.getAllByRole("button", { name: /cancel/i })).toHaveLength(2);
  });
});
