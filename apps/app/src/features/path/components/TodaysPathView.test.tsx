import type { ComponentProps } from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TodaysPathView } from "./TodaysPathView";
import type { OrderedStop, FlexibleStop } from "../lib/todaysPath";
import type { OwedVisitNoCoords } from "../lib/owedVisits";

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
      noLocation={props?.noLocation ?? []}
      isLoading={props?.isLoading ?? false}
      status={props?.status ?? "ok"}
      onStart={props?.onStart ?? vi.fn()}
      onAddNearby={props?.onAddNearby ?? vi.fn()}
      onOpenDeal={props?.onOpenDeal ?? vi.fn()}
      isStarting={props?.isStarting}
      remainingMin={props?.remainingMin ?? 120}
      windowEndHour={props?.windowEndHour ?? 17}
      origin={props?.origin ?? { lat: 30, lng: -97 }}
      showAddNearby={props?.showAddNearby}
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

  it("no longer renders the 'Won't fit today' overflow section, but keeps feeding the add-stops pool (v2.2 A4)", () => {
    renderView();
    // A4: the visible overflow list is gone.
    expect(screen.queryByText(/won't fit today/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/still waiting for you tomorrow/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Overflow Co")).not.toBeInTheDocument();
    // But the overflow data still flows in and feeds the "Add more stops" pool:
    // there is a candidate, so the add-stops control is present and enabled.
    const addStops = screen.getByRole("button", { name: /add more stops/i });
    expect(addStops).toBeInTheDocument();
    expect(addStops).not.toBeDisabled();
  });

  it("Add more nearby opens the discovery (when the flag is on)", () => {
    const onAddNearby = vi.fn();
    renderView({ onAddNearby, showAddNearby: true });
    fireEvent.click(screen.getByRole("button", { name: /add more nearby/i }));
    expect(onAddNearby).toHaveBeenCalledTimes(1);
  });

  // ─── A3: single global flag-gate on the "Add more nearby" entry point ─

  it("hides the 'Add more nearby' entry point when the flag is off (default)", () => {
    renderView({ showAddNearby: false });
    // The demoted text link is gone...
    expect(screen.queryByRole("button", { name: /add more nearby/i })).not.toBeInTheDocument();
    // ...but the flag gates ONLY that control: the "+" dashed add-stops row and
    // Start driving are untouched.
    expect(screen.getByRole("button", { name: /add more stops/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start driving/i })).toBeInTheDocument();
  });

  it("renders the 'Add more nearby' entry point only when the flag is on", () => {
    renderView({ showAddNearby: true });
    expect(screen.getByRole("button", { name: /add more nearby/i })).toBeInTheDocument();
  });

  it("keeps 'Build my day' working on an empty day regardless of the flag", () => {
    // The empty-state primary action shares onAddNearby but is NOT flag-gated:
    // it renders and fires even when the "Add more nearby" link is hidden.
    const onAddNearby = vi.fn();
    renderView({ proposal: [], overflow: [], onAddNearby, showAddNearby: false });
    const build = screen.getByRole("button", { name: /build my day/i });
    expect(build).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add more nearby/i })).not.toBeInTheDocument();
    fireEvent.click(build);
    expect(onAddNearby).toHaveBeenCalledTimes(1);
  });

  it("surfaces no-location owed drop-ins in their own group with an Open-deal action, NOT in the routed plan", () => {
    const onOpenDeal = vi.fn();
    const noLocation: OwedVisitNoCoords[] = [
      { taskId: "nl1", dealId: "deal-nl-1", name: "No Map Co", address: "9 Off Grid Rd" },
    ];
    renderView({ noLocation, onOpenDeal });

    // The group header + hint render.
    expect(screen.getByText(/no location yet/i)).toBeInTheDocument();
    // The outer row (items-center) holds both the text and the action button.
    const row = screen.getByText("No Map Co").closest<HTMLElement>("div.items-center")!;
    expect(within(row).getByText(/add an address to put this on your route/i)).toBeInTheDocument();

    // It is NOT one of the routed list items (proposal / overflow render as <li>).
    const listItemTexts = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(listItemTexts.some((t) => t.includes("No Map Co"))).toBe(false);

    // Open deal navigates to the deal so the rep can add an address.
    fireEvent.click(within(row).getByRole("button", { name: /open deal/i }));
    expect(onOpenDeal).toHaveBeenCalledWith("deal-nl-1");
  });

  it("shows the no-location group even when the routable day is empty (not 'all caught up')", () => {
    const noLocation: OwedVisitNoCoords[] = [
      { taskId: "nl1", dealId: "deal-nl-1", name: "No Map Co", address: null },
    ];
    renderView({ proposal: [], overflow: [], noLocation });
    expect(screen.getByText("No Map Co")).toBeInTheDocument();
    // The caught-up empty state must NOT show: the rep still owes this drop-in.
    expect(screen.queryByText(/all caught up/i)).not.toBeInTheDocument();
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

  it("shows Start on an appointment-only plan and starts it with an empty flexible array", () => {
    // A day with ONLY appointments (no owed/due/nearby flexible stops) must still
    // offer the primary action: the run view drives the appointments live. Start
    // hands back an empty flexible array (appointments are never created as stops).
    const onStart = vi.fn();
    const apptOnly: OrderedStop[] = [proposal[1]!];
    renderView({ proposal: apptOnly, overflow: [], onStart, showAddNearby: true });
    expect(screen.getByText("Renewal review")).toBeInTheDocument();
    const start = screen.getByRole("button", { name: /start driving/i });
    expect(start).toBeInTheDocument();
    fireEvent.click(start);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart.mock.calls[0]![0]).toEqual([]);
    // Add more nearby is still available (flag on) so the rep can fill an empty run.
    expect(screen.getByRole("button", { name: /add more nearby/i })).toBeInTheDocument();
  });

  it("an appointment row with a dealId exposes an Open-deal control that opens the deal", () => {
    const onOpenDeal = vi.fn();
    renderView({ onOpenDeal });
    const items = screen.getAllByRole("listitem");
    const apptRow = items.find((li) => (li.textContent ?? "").includes("Renewal review"))!;
    // The appointment (dealId "d2") shows Open deal; clicking opens that deal.
    const openBtn = within(apptRow).getByRole("button", { name: /open deal/i });
    fireEvent.click(openBtn);
    expect(onOpenDeal).toHaveBeenCalledWith("d2");
    // The calendar anchor is still not removable.
    expect(within(apptRow).queryByRole("button", { name: /remove renewal review/i })).not.toBeInTheDocument();
  });

  it("an external appointment (no dealId) shows no Open-deal control", () => {
    const external: OrderedStop[] = [
      {
        id: "ext1", kind: "external", tier: "appointment", name: "Team offsite",
        dealId: null, lat: 30.2, lng: -97.2,
        startAt: "2026-08-09T18:00:00Z", endAt: "2026-08-09T19:00:00Z", ageDays: null,
      },
    ];
    renderView({ proposal: external, overflow: [] });
    const apptRow = screen.getByText("Team offsite").closest("li")!;
    expect(within(apptRow).queryByRole("button", { name: /open deal/i })).not.toBeInTheDocument();
  });

  it("flexible rows keep the Remove control and never show Open-deal", () => {
    renderView();
    const items = screen.getAllByRole("listitem");
    const owedRow = items.find((li) => (li.textContent ?? "").includes("Owed Co"))!;
    // Flexible stop: removable, and no Open-deal even though it carries a dealId.
    expect(within(owedRow).getByRole("button", { name: /remove owed co/i })).toBeInTheDocument();
    expect(within(owedRow).queryByRole("button", { name: /open deal/i })).not.toBeInTheDocument();
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

  it("renders Start driving at the bottom, after the stop list and the add-stops control, with 'Why this order?' beneath it", () => {
    renderView({ showAddNearby: true });
    const start = screen.getByRole("button", { name: /start driving/i });
    const addNearby = screen.getByRole("button", { name: /add more nearby/i });
    const listItems = screen.getAllByRole("listitem");
    const lastRow = listItems[listItems.length - 1]!;
    const why = screen.getByText(/why this order/i);

    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    // Start driving now comes AFTER the last stop row (not before the list).
    expect(follows(lastRow, start)).toBe(true);
    // Start driving comes AFTER the "Add more nearby" add-stops control.
    expect(follows(addNearby, start)).toBe(true);
    // "Why this order?" sits directly beneath the Start button.
    expect(follows(start, why)).toBe(true);
  });

  // ─── A8: dashed open-slot add-stops row ─────────────────────────────

  it("renders the add-stops control as a dashed open-slot row with a plus-prefixed label and inline capacity string", () => {
    renderView({ remainingMin: 50, windowEndHour: 18 });
    const addStops = screen.getByRole("button", { name: /add more stops/i });
    // Dashed treatment reads as an open slot; full-width row, no filled bg.
    expect(addStops.className).toMatch(/border-dashed/);
    expect(addStops.className).toMatch(/\bw-full\b/);
    expect(addStops.className).toMatch(/bg-transparent/);
    // The label carries the plus glyph + the capacity string on the same row.
    expect(within(addStops).getByText("Add more stops")).toBeInTheDocument();
    expect(within(addStops).getByText(/about 50 minutes still open/i)).toBeInTheDocument();
  });

  it("disables (not hides) the dashed add-stops row when no candidate remains", () => {
    // No overflow candidates -> the pool is empty, so the control is disabled.
    renderView({ overflow: [] });
    const addStops = screen.getByRole("button", { name: /add more stops/i });
    expect(addStops).toBeInTheDocument();
    expect(addStops).toBeDisabled();
  });

  it("disables (not hides) the dashed add-stops row when the day is full, showing the full-day sentence", () => {
    renderView({ remainingMin: 5, windowEndHour: 18 });
    const addStops = screen.getByRole("button", { name: /add more stops/i });
    expect(addStops).toBeDisabled();
    expect(within(addStops).getByText(/that's a full day, nothing else fits before 6:00/i)).toBeInTheDocument();
  });

  it("shows the remaining capacity in plain terms on the add-stops row when more stops still fit", () => {
    renderView({ remainingMin: 50, windowEndHour: 18 });
    expect(screen.getByText(/about 50 minutes still open/i)).toBeInTheDocument();
    expect(screen.queryByText(/that's a full day/i)).not.toBeInTheDocument();
  });

  // ─── A9: tinted fill-notice panel ────────────────────────────────────

  it("renders the fill notice as a panel with the new copy, an Undo affordance, and a dismiss that hides it", () => {
    // the default `proposal` fixture has committed stops (appointment/owed/due) + 1 nearby
    renderView();
    expect(screen.getByText(/added 1 stop to your day\./i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^undo$/i })).toBeInTheDocument();
    const dismiss = screen.getByRole("button", { name: /dismiss/i });
    fireEvent.click(dismiss);
    expect(screen.queryByText(/added 1 stop to your day\./i)).not.toBeInTheDocument();
  });

  it("pluralizes the fill-notice count", () => {
    const proposal = [
      { id: "ap", kind: "appointment", tier: "appointment", name: "Appt", dealId: "d", lat: 1, lng: 1, startAt: "2026-08-10T17:00:00Z", endAt: null, ageDays: null },
      { id: "n1", kind: "flexible", tier: "nearby", name: "N1", dealId: null, lat: 1, lng: 1, startAt: null, endAt: null, ageDays: null },
      { id: "n2", kind: "flexible", tier: "nearby", name: "N2", dealId: null, lat: 1, lng: 1, startAt: null, endAt: null, ageDays: null },
    ] as OrderedStop[];
    renderView({ proposal, overflow: [] });
    expect(screen.getByText(/added 2 stops to your day\./i)).toBeInTheDocument();
  });

  it("does not show the fill notice on an empty day", () => {
    renderView({ proposal: [], overflow: [] });
    expect(screen.queryByText(/to your day\./i)).not.toBeInTheDocument();
  });

  it("does not show the fill notice when the day has no nearby fill", () => {
    const proposal = [
      { id: "o1", kind: "flexible", tier: "past_due", name: "Owed", dealId: "d", lat: 1, lng: 1, startAt: null, endAt: null, ageDays: 5 },
    ] as OrderedStop[];
    renderView({ proposal, overflow: [] });
    expect(screen.queryByText(/to your day\./i)).not.toBeInTheDocument();
  });

  // ─── A8: exactly one filled/primary button ───────────────────────────

  it("carries exactly one filled/primary button ('Start driving')", () => {
    renderView();
    const filled = screen
      .getAllByRole("button")
      .filter((b) => b.classList.contains("bg-brand-primary"));
    expect(filled).toHaveLength(1);
    expect(filled[0]!).toHaveAccessibleName(/start driving/i);
  });

  it("empty day offers a single 'Build my day' action", () => {
    const onAddNearby = vi.fn();
    renderView({ proposal: [], overflow: [], onAddNearby });
    fireEvent.click(screen.getByRole("button", { name: /build my day/i }));
    expect(onAddNearby).toHaveBeenCalledTimes(1);
  });

  describe("one-tap 'Add more stops' (FR-PATH-UX-11 incremental insert)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    // Freeze the clock so the component's captured `now` is deterministic and
    // the insertStop feasibility math does not depend on when the suite runs.
    // Fake only Date so React Testing Library timers are untouched.
    function freezeAt(iso: string) {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(iso));
    }

    // No appointments, an origin next to the candidate, and a wide-open window:
    // the overflow candidate has an obvious gap and folds into the plan.
    const appointmentFreeProposal: OrderedStop[] = [
      { id: "o1", kind: "flexible", tier: "past_due", name: "Owed Co", dealId: "d1", lat: 30.01, lng: -97.01, startAt: null, endAt: null, ageDays: 4 },
    ];
    const fittingOverflow: FlexibleStop[] = [
      { id: "fit1", dealId: null, name: "Fits Co", lat: 30.0, lng: -97.0, tier: "nearby", ageDays: null },
    ];

    it("inserts the next candidate into the plan when it fits", () => {
      freezeAt("2026-08-10T09:00:00Z");
      renderView({
        proposal: appointmentFreeProposal,
        overflow: fittingOverflow,
        origin: { lat: 30.0, lng: -97.0 },
        windowEndHour: 17,
      });

      // Before the tap the candidate lives only in the "won't fit" list.
      const beforeItems = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
      expect(beforeItems.some((t) => t.includes("Fits Co"))).toBe(false);

      fireEvent.click(screen.getByRole("button", { name: /add more stops/i }));

      // Now it is a real stop in the plan (a list item), not just overflow.
      const afterItems = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
      expect(afterItems.some((t) => t.includes("Fits Co"))).toBe(true);
      // The originally placed stop is still present (insertStop splices the
      // candidate in without dropping the stop already placed).
      expect(afterItems.some((t) => t.includes("Owed Co"))).toBe(true);
    });

    it("leaves the plan unchanged when the candidate cannot be placed", () => {
      // windowEndHour == now's hour leaves zero minutes, so nothing new fits.
      freezeAt("2026-08-10T17:00:00Z");
      renderView({
        proposal: appointmentFreeProposal,
        overflow: fittingOverflow,
        origin: { lat: 30.0, lng: -97.0 },
        windowEndHour: 17,
      });

      fireEvent.click(screen.getByRole("button", { name: /add more stops/i }));

      // The candidate did not join the plan (still no matching list item).
      const items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
      expect(items.some((t) => t.includes("Fits Co"))).toBe(false);
      // The placed stop is untouched.
      expect(screen.getByText("Owed Co")).toBeInTheDocument();
    });
  });
});
