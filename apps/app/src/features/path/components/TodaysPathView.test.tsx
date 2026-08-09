import type { ComponentProps } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TodaysPathView } from "./TodaysPathView";
import type { OrderedStop, FlexibleStop } from "../lib/todaysPath";

// A prioritized run list mixing all four tiers. Run order is: a past-due owed
// drop-in, then a fixed appointment, then a due-today follow-up, then a nearby
// fill. The assembler produces this; the view only renders it.
const proposal: OrderedStop[] = [
  {
    id: "owed1", kind: "flexible", tier: "past_due", name: "Owed Co",
    dealId: "d1", lat: 30.1, lng: -97.1, startAt: null, endAt: null, ageDays: 12,
  },
  {
    id: "appt1", kind: "appointment", tier: "appointment", name: "Renewal review",
    dealId: "d2", lat: 30.2, lng: -97.2,
    startAt: "2026-08-09T17:30:00Z", endAt: "2026-08-09T18:00:00Z", ageDays: null,
  },
  {
    id: "due1", kind: "flexible", tier: "due_today", name: "DueToday Co",
    dealId: "d3", lat: 30.3, lng: -97.3, startAt: null, endAt: null, ageDays: null,
  },
  {
    id: "near1", kind: "flexible", tier: "nearby", name: "Nearby Co",
    dealId: null, lat: 30.4, lng: -97.4, startAt: null, endAt: null, ageDays: null,
  },
];

const overflow: FlexibleStop[] = [
  { id: "of1", dealId: null, name: "Overflow Co", lat: 30.5, lng: -97.5, tier: "nearby", ageDays: null },
];

// Mirrors the component's local-tz clock formatting so the assertion is
// tz-independent (matches the dedicated time column, not the reason sentence).
function fmtLocalTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function renderView(props?: Partial<ComponentProps<typeof TodaysPathView>>) {
  return render(
    <TodaysPathView
      proposal={props?.proposal ?? proposal}
      overflow={props?.overflow ?? overflow}
      isLoading={props?.isLoading ?? false}
      status={props?.status ?? "ok"}
      onStart={props?.onStart ?? vi.fn()}
      onAddNearby={props?.onAddNearby ?? vi.fn()}
      isStarting={props?.isStarting}
    />,
  );
}

describe("TodaysPathView", () => {
  it("renders the proposal tiers in run order, with an appointment time and a past-due age", () => {
    renderView();

    // All four stops render.
    expect(screen.getByText("Owed Co")).toBeInTheDocument();
    expect(screen.getByText("Renewal review")).toBeInTheDocument();
    expect(screen.getByText("DueToday Co")).toBeInTheDocument();
    expect(screen.getByText("Nearby Co")).toBeInTheDocument();

    // Run order is preserved (the list items carry the names in sequence).
    const items = screen.getAllByRole("listitem");
    const names = items.map((li) => li.textContent ?? "");
    const orderOf = (n: string) => names.findIndex((t) => t.includes(n));
    expect(orderOf("Owed Co")).toBeLessThan(orderOf("Renewal review"));
    expect(orderOf("Renewal review")).toBeLessThan(orderOf("DueToday Co"));
    expect(orderOf("DueToday Co")).toBeLessThan(orderOf("Nearby Co"));

    // The past-due stop shows a plain reason line, not a tier chip or age.
    expect(screen.getByText("You have not stopped by in 12 days.")).toBeInTheDocument();
    expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/past due/i)).not.toBeInTheDocument();

    // The appointment carries its own reason line (FR-PATH-UX-05, every row).
    const apptRow = items[orderOf("Renewal review")]!;
    expect(within(apptRow).getByText(/^You have a .+ here\.$/)).toBeInTheDocument();
    // The dedicated time column still renders the formatted clock time.
    expect(within(apptRow).getByText(fmtLocalTime("2026-08-09T17:30:00Z"))).toBeInTheDocument();
  });

  it("removing a flexible stop drops it from the plan", () => {
    renderView();
    expect(screen.getByText("Owed Co")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /remove owed co/i }));
    expect(screen.queryByText("Owed Co")).not.toBeInTheDocument();
    // Other stops stay.
    expect(screen.getByText("DueToday Co")).toBeInTheDocument();
  });

  it("appointments cannot be removed (no remove control on the calendar anchor)", () => {
    renderView();
    expect(screen.queryByRole("button", { name: /remove renewal review/i })).not.toBeInTheDocument();
  });

  it("Start invokes onStart with only the flexible stops (appointments excluded)", () => {
    const onStart = vi.fn();
    renderView({ onStart });
    fireEvent.click(screen.getByRole("button", { name: /start driving/i }));
    expect(onStart).toHaveBeenCalledTimes(1);
    const passed = onStart.mock.calls[0]![0] as OrderedStop[];
    expect(passed).toHaveLength(3);
    expect(passed.every((s) => s.kind === "flexible")).toBe(true);
    expect(passed.map((s) => s.id)).toEqual(["owed1", "due1", "near1"]);
  });

  it("Start reflects prior removals (a removed flexible stop is not started)", () => {
    const onStart = vi.fn();
    renderView({ onStart });
    fireEvent.click(screen.getByRole("button", { name: /remove owed co/i }));
    fireEvent.click(screen.getByRole("button", { name: /start driving/i }));
    const passed = onStart.mock.calls[0]![0] as OrderedStop[];
    expect(passed.map((s) => s.id)).toEqual(["due1", "near1"]);
  });

  it("renders the overflow list under a carry-over heading", () => {
    renderView();
    expect(screen.getByText(/won't fit today/i)).toBeInTheDocument();
    expect(screen.getByText(/still waiting for you tomorrow/i)).toBeInTheDocument();
    expect(screen.getByText("Overflow Co")).toBeInTheDocument();
  });

  it("Add more nearby opens the discovery", () => {
    const onAddNearby = vi.fn();
    renderView({ onAddNearby });
    fireEvent.click(screen.getByRole("button", { name: /add more nearby/i }));
    expect(onAddNearby).toHaveBeenCalledTimes(1);
  });

  it("empty proposal renders a friendly empty state that still offers find nearby", () => {
    const onAddNearby = vi.fn();
    renderView({ proposal: [], overflow: [], onAddNearby });
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /build my day/i }));
    expect(onAddNearby).toHaveBeenCalledTimes(1);
    // No Start button when there's nothing to run.
    expect(screen.queryByRole("button", { name: /start driving/i })).not.toBeInTheDocument();
  });

  it("hides Start when the plan is all appointments (no flexible stops to run)", () => {
    const apptOnly: OrderedStop[] = [proposal[1]!];
    renderView({ proposal: apptOnly, overflow: [] });
    expect(screen.getByText("Renewal review")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start driving/i })).not.toBeInTheDocument();
    // Add more nearby is still available so the rep can fill an empty run.
    expect(screen.getByRole("button", { name: /add more nearby/i })).toBeInTheDocument();
  });

  it("shows a non-blocking reconnect notice but still renders the plan when status is needs_reconnect", () => {
    renderView({ status: "needs_reconnect" });
    expect(screen.getByText(/reconnect your calendar/i)).toBeInTheDocument();
    // The plan still renders (the calendar tier is simply absent upstream).
    expect(screen.getByText("Owed Co")).toBeInTheDocument();
  });

  it("renders a loading state while the assembler is gathering tiers", () => {
    renderView({ isLoading: true });
    expect(screen.getByText(/building today's path/i)).toBeInTheDocument();
    expect(screen.queryByText("Owed Co")).not.toBeInTheDocument();
  });

  it("shows the one-sentence 'Why this order?' explanation on demand", () => {
    renderView();
    fireEvent.click(screen.getByText(/why this order/i));
    expect(screen.getByText(/Appointments go where they are booked/i)).toBeInTheDocument();
  });

  it("empty day offers a single 'Build my day' action", () => {
    const onAddNearby = vi.fn();
    renderView({ proposal: [], overflow: [], onAddNearby });
    fireEvent.click(screen.getByRole("button", { name: /build my day/i }));
    expect(onAddNearby).toHaveBeenCalledTimes(1);
  });
});
