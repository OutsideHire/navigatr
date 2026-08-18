import type { ComponentProps } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TodaysPathView } from "./TodaysPathView";
import type { OrderedStop, FlexibleStop } from "../lib/todaysPath";
import type { OwedVisitNoCoords } from "../lib/owedVisits";

// DayStopsMap owns MapLibre (a real WebGL context jsdom lacks), so stub it with
// a lightweight component that records the props the toggle wires (stop count +
// active flag) and exposes a testid. This lets us assert the List/Map toggle
// wiring and retention without a real map.
vi.mock("./DayStopsMap", () => ({
  DayStopsMap: (props: {
    stops: Array<{ id: string }>;
    active?: boolean;
    onStopClick: (id: string) => void;
  }) => (
    <div
      data-testid="day-stops-map"
      data-stops={props.stops.length}
      data-active={String(props.active)}
    >
      {/* Surface each pin as a button so tests can drive onStopClick wiring
          without a real map. */}
      {props.stops.map((s) => (
        <button
          key={s.id}
          type="button"
          data-testid={`map-pin-${s.id}`}
          onClick={() => props.onStopClick(s.id)}
        />
      ))}
    </div>
  ),
}));

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

    // The past-due stop shows the detail-only sentence (v2.2 B 4.5.1), not a
    // tier chip or "overdue"/"past due" text.
    expect(screen.getByText("12 days since your last stop.")).toBeInTheDocument();
    expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/past due/i)).not.toBeInTheDocument();

    // The appointment carries the "appointment" left-rail label; the sentence is
    // the contact (not plumbed) so it is empty, and the time lives in its column.
    const apptRow = items[orderOf("Renewal review")]!;
    expect(within(apptRow).getByText("appointment")).toBeInTheDocument();
    // The dedicated time column still renders the formatted clock time.
    expect(within(apptRow).getByText(fmtLocalTime("2026-08-09T17:30:00Z"))).toBeInTheDocument();
  });

  it("renders the left-rail category label on landing rows (v2.2 B 4.5)", () => {
    renderView();
    const items = screen.getAllByRole("listitem");
    const orderOf = (n: string) => items.findIndex((li) => (li.textContent ?? "").includes(n));
    // Owed drop-in -> "anytime"; discovery fill -> "on the way"; appointment -> "appointment".
    expect(within(items[orderOf("Owed Co")]!).getByText("anytime")).toBeInTheDocument();
    expect(within(items[orderOf("Nearby Co")]!).getByText("on the way")).toBeInTheDocument();
    expect(within(items[orderOf("Renewal review")]!).getByText("appointment")).toBeInTheDocument();
    // The discovery fill's detail-only sentence.
    expect(within(items[orderOf("Nearby Co")]!).getByText("Nobody's been in yet.")).toBeInTheDocument();
  });

  it("a 'you promised' row shows the label + owner sentence when the date was asserted", () => {
    const promised: OrderedStop[] = [
      {
        id: "p1", kind: "flexible", tier: "past_due", name: "Promised Co",
        dealId: "d9", lat: 30.1, lng: -97.1, startAt: null, endAt: null, ageDays: 3,
        datePromised: true,
      },
    ];
    renderView({ proposal: promised, overflow: [] });
    const row = screen.getByText("Promised Co").closest("li")!;
    expect(within(row).getByText("you promised")).toBeInTheDocument();
    expect(within(row).getByText("The owner is expecting you.")).toBeInTheDocument();
  });

  it("an appointment row with no contact renders no detail sentence and does not break layout", () => {
    const apptOnly: OrderedStop[] = [proposal[1]!];
    renderView({ proposal: apptOnly, overflow: [] });
    const row = screen.getByText("Renewal review").closest("li")!;
    // The label + name + time all render; there is no empty detail sentence.
    expect(within(row).getByText("appointment")).toBeInTheDocument();
    expect(within(row).getByText("Renewal review")).toBeInTheDocument();
    expect(within(row).getByText(fmtLocalTime("2026-08-09T17:30:00Z"))).toBeInTheDocument();
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
    expect(screen.queryByText(/No stops today/i)).not.toBeInTheDocument();
  });

  it("empty proposal renders a friendly empty state that still offers find nearby", () => {
    const onAddNearby = vi.fn();
    renderView({ proposal: [], overflow: [], onAddNearby });
    expect(screen.getByText(/No stops today/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /build my day/i }));
    expect(onAddNearby).toHaveBeenCalledTimes(1);
    // No Start button when there's nothing to run.
    expect(screen.queryByRole("button", { name: /start driving/i })).not.toBeInTheDocument();
  });

  it("shows the empty state when nothing is scheduled even if a nearby fill pool exists (D-12)", () => {
    // Robert's case: no scheduled stops, but a background nearby pool (overflow)
    // is present. The day must still read as empty ("No stops today / Build my
    // day"), NOT an empty list with an "Add more stops" row. Before the fix the
    // pool made `empty` false, so the empty state was effectively unreachable.
    renderView({ proposal: [], noLocation: [] }); // default overflow is NON-empty
    expect(screen.getByText(/No stops today/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /build my day/i })).toBeInTheDocument();
    // The empty-list affordances must NOT render alongside the empty card.
    expect(screen.queryByRole("button", { name: /add more stops/i })).not.toBeInTheDocument();
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
    // 50min rounds to the nearest quarter hour (45), hedged with "about".
    expect(within(addStops).getByText("Add more stops")).toBeInTheDocument();
    expect(within(addStops).getByText(/about 45 minutes still open/i)).toBeInTheDocument();
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
    expect(screen.getByText(/about 45 minutes still open/i)).toBeInTheDocument();
    expect(screen.queryByText(/that's a full day/i)).not.toBeInTheDocument();
  });

  // ─── A9 + B 4.4: tinted fill-notice panel (count reflects THIS fill) ──

  it("shows the fill notice after a fill, with the new copy, an Undo affordance, and a dismiss that hides it", () => {
    // A committed day (owed) with one fitting pool candidate. The notice count
    // now reflects the stops the fill APPENDED (B 4.4), not nearby-in-proposal:
    // before a tap there is nothing to announce.
    const proposal = [
      { id: "o1", kind: "flexible", tier: "past_due", name: "Owed", dealId: "d", lat: 30.0, lng: -97.0, startAt: null, endAt: null, ageDays: 5 },
    ] as OrderedStop[];
    const overflow = [
      { id: "f1", dealId: null, name: "Fill One", lat: 30.0, lng: -97.0, tier: "nearby", ageDays: null },
    ] as FlexibleStop[];
    renderView({ proposal, overflow, remainingMin: 120, origin: { lat: 30.0, lng: -97.0 } });

    // No fill yet -> no notice.
    expect(screen.queryByText(/to your day\./i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /add more stops/i }));

    expect(screen.getByText(/added 1 stop to your day\./i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^undo$/i })).toBeInTheDocument();
    const dismiss = screen.getByRole("button", { name: /dismiss/i });
    fireEvent.click(dismiss);
    expect(screen.queryByText(/added 1 stop to your day\./i)).not.toBeInTheDocument();
  });

  it("pluralizes the fill-notice count from the number of stops the fill appended", () => {
    const proposal = [
      { id: "o1", kind: "flexible", tier: "past_due", name: "Owed", dealId: "d", lat: 30.0, lng: -97.0, startAt: null, endAt: null, ageDays: 5 },
    ] as OrderedStop[];
    const overflow = [
      { id: "f1", dealId: null, name: "Fill One", lat: 30.0, lng: -97.0, tier: "nearby", ageDays: null },
      { id: "f2", dealId: null, name: "Fill Two", lat: 30.0, lng: -97.0, tier: "nearby", ageDays: null },
    ] as FlexibleStop[];
    // A wide-open budget: one tap folds BOTH candidates in (fill to capacity).
    renderView({ proposal, overflow, remainingMin: 300, origin: { lat: 30.0, lng: -97.0 } });

    fireEvent.click(screen.getByRole("button", { name: /add more stops/i }));

    expect(screen.getByText(/added 2 stops to your day\./i)).toBeInTheDocument();
  });

  it("does not show the fill notice on an empty day", () => {
    renderView({ proposal: [], overflow: [] });
    expect(screen.queryByText(/to your day\./i)).not.toBeInTheDocument();
  });

  it("does not show the fill notice before any fill is made", () => {
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

  // ─── A5 / 3.2: List | Map segmented toggle ──────────────────────────

  describe("List | Map view toggle", () => {
    it("renders the toggle with List active by default: list content shown, map wrapper CSS-hidden", () => {
      renderView();
      const listTab = screen.getByRole("tab", { name: /^list$/i });
      const mapTab = screen.getByRole("tab", { name: /^map$/i });
      expect(listTab).toBeInTheDocument();
      expect(mapTab).toBeInTheDocument();
      // List is the default view.
      expect(listTab).toHaveAttribute("aria-selected", "true");
      expect(mapTab).toHaveAttribute("aria-selected", "false");

      const listWrap = screen.getByTestId("day-list-wrapper");
      const mapWrap = screen.getByTestId("day-map-wrapper");
      // List content is visible; the map wrapper is CSS-hidden (not unmounted).
      expect(listWrap.classList.contains("hidden")).toBe(false);
      expect(mapWrap.classList.contains("hidden")).toBe(true);
    });

    it("clicking Map shows the map wrapper and hides the list wrapper; clicking List reverts", () => {
      renderView();
      const listWrap = screen.getByTestId("day-list-wrapper");
      const mapWrap = screen.getByTestId("day-map-wrapper");

      fireEvent.click(screen.getByRole("tab", { name: /^map$/i }));
      expect(mapWrap.classList.contains("hidden")).toBe(false);
      expect(listWrap.classList.contains("hidden")).toBe(true);
      expect(screen.getByRole("tab", { name: /^map$/i })).toHaveAttribute("aria-selected", "true");

      fireEvent.click(screen.getByRole("tab", { name: /^list$/i }));
      expect(listWrap.classList.contains("hidden")).toBe(false);
      expect(mapWrap.classList.contains("hidden")).toBe(true);
    });

    it("keeps DayStopsMap mounted in both views (retained, CSS-hidden not unmounted)", () => {
      renderView();
      // Mounted even while List is the active view.
      expect(screen.getByTestId("day-stops-map")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("tab", { name: /^map$/i }));
      // Same instance still present after switching to Map.
      expect(screen.getByTestId("day-stops-map")).toBeInTheDocument();
    });

    it("passes the day's coordinate-bearing stops to the map and flags active only in Map view", () => {
      renderView();
      const map = screen.getByTestId("day-stops-map");
      // All four fixture stops carry coords, so all four go to the map.
      expect(map).toHaveAttribute("data-stops", "4");
      // Inactive under List (so the map can skip resize work until shown).
      expect(map).toHaveAttribute("data-active", "false");
      fireEvent.click(screen.getByRole("tab", { name: /^map$/i }));
      expect(screen.getByTestId("day-stops-map")).toHaveAttribute("data-active", "true");
    });

    it("keeps Start driving present in both views", () => {
      renderView();
      expect(screen.getByRole("button", { name: /start driving/i })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("tab", { name: /^map$/i }));
      expect(screen.getByRole("button", { name: /start driving/i })).toBeInTheDocument();
    });

    it("wires a map pin tap to open the stop's deal (dealId parity with the list)", () => {
      const onOpenDeal = vi.fn();
      renderView({ onOpenDeal });
      // The owed fixture stop carries dealId "d1"; tapping its pin opens the deal.
      fireEvent.click(screen.getByTestId("map-pin-owed1"));
      expect(onOpenDeal).toHaveBeenCalledWith("d1");
    });

    it("a map pin for a stop with no dealId is a no-op (no deal to open yet)", () => {
      const onOpenDeal = vi.fn();
      renderView({ onOpenDeal });
      // "near1" is a nearby fill with dealId null; tapping it opens nothing.
      fireEvent.click(screen.getByTestId("map-pin-near1"));
      expect(onOpenDeal).not.toHaveBeenCalled();
    });
  });

  describe("one-tap 'Add more stops' (v2.2 B 4.4 fill to capacity)", () => {
    // A committed day (owed) with an origin next to the candidates.
    const appointmentFreeProposal: OrderedStop[] = [
      { id: "o1", kind: "flexible", tier: "past_due", name: "Owed Co", dealId: "d1", lat: 30.01, lng: -97.01, startAt: null, endAt: null, ageDays: 4 },
    ];
    const fittingOverflow: FlexibleStop[] = [
      { id: "fit1", dealId: null, name: "Fits Co", lat: 30.0, lng: -97.0, tier: "nearby", ageDays: null },
    ];

    it("folds the fitting candidate into the plan when it fits", () => {
      renderView({
        proposal: appointmentFreeProposal,
        overflow: fittingOverflow,
        origin: { lat: 30.0, lng: -97.0 },
        remainingMin: 120,
      });

      // Before the tap the candidate is not a placed stop.
      const beforeItems = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
      expect(beforeItems.some((t) => t.includes("Fits Co"))).toBe(false);

      fireEvent.click(screen.getByRole("button", { name: /add more stops/i }));

      // Now it is a real stop in the plan (a list item), appended after Owed Co.
      const afterItems = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
      expect(afterItems.some((t) => t.includes("Fits Co"))).toBe(true);
      // The originally placed stop is still present and still first (append in place).
      expect(afterItems.some((t) => t.includes("Owed Co"))).toBe(true);
      const idxOwed = afterItems.findIndex((t) => t.includes("Owed Co"));
      const idxFit = afterItems.findIndex((t) => t.includes("Fits Co"));
      expect(idxOwed).toBeLessThan(idxFit);
    });

    it("one tap appends MULTIPLE stops, filling the remaining capacity", () => {
      const overflow = [
        { id: "f1", dealId: null, name: "Fill One", lat: 30.0, lng: -97.0, tier: "nearby", ageDays: null },
        { id: "f2", dealId: null, name: "Fill Two", lat: 30.0, lng: -97.0, tier: "nearby", ageDays: null },
        { id: "f3", dealId: null, name: "Fill Three", lat: 30.0, lng: -97.0, tier: "nearby", ageDays: null },
      ] as FlexibleStop[];
      renderView({
        proposal: appointmentFreeProposal,
        overflow,
        origin: { lat: 30.0, lng: -97.0 },
        remainingMin: 300, // wide open: all three (45 min dwell) fit in one tap
      });

      fireEvent.click(screen.getByRole("button", { name: /add more stops/i }));

      const items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
      expect(items.some((t) => t.includes("Fill One"))).toBe(true);
      expect(items.some((t) => t.includes("Fill Two"))).toBe(true);
      expect(items.some((t) => t.includes("Fill Three"))).toBe(true);
      // The notice count reflects all three the fill appended.
      expect(screen.getByText(/added 3 stops to your day\./i)).toBeInTheDocument();
    });

    it("leaves the plan unchanged when the closest candidate does not fit the budget", () => {
      // Budget clears the disable gate (>= 20) but the only candidate is far
      // enough that drive + dwell exceeds it, so the fill appends nothing.
      const farOverflow = [
        { id: "far", dealId: null, name: "Far Co", lat: 31.0, lng: -97.0, tier: "nearby", ageDays: null },
      ] as FlexibleStop[];
      renderView({
        proposal: appointmentFreeProposal,
        overflow: farOverflow,
        origin: { lat: 30.0, lng: -97.0 },
        remainingMin: 30,
      });

      fireEvent.click(screen.getByRole("button", { name: /add more stops/i }));

      const items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
      expect(items.some((t) => t.includes("Far Co"))).toBe(false);
      // The placed stop is untouched, and nothing is announced.
      expect(screen.getByText("Owed Co")).toBeInTheDocument();
      expect(screen.queryByText(/to your day\./i)).not.toBeInTheDocument();
    });

    it("disables the control when the pool is exhausted (no overflow)", () => {
      renderView({ proposal: appointmentFreeProposal, overflow: [], remainingMin: 120 });
      expect(screen.getByRole("button", { name: /add more stops/i })).toBeDisabled();
    });

    it("repeated taps deplete a single budget and never overcommit the day (no cross-tap double-spend)", () => {
      // 60-min budget; pool = two ~15-min near stops + one ~40-min far stop.
      // Tap 1 folds in the two near stops (30 min) and stops on the 40. Tap 2
      // must see the DEPLETED budget (~30) and refuse the far stop, not re-spend
      // the full 60 (which would push the day ~70 min over capacity).
      const origin = { lat: 30, lng: -97 };
      const proposal = [
        { id: "o1", kind: "flexible", tier: "past_due", name: "Owed Co", dealId: "d1", lat: 30, lng: -97, startAt: null, endAt: null, ageDays: 4 },
      ] as OrderedStop[];
      const overflow = [
        { id: "n1", dealId: null, name: "Near One", lat: 30.0001, lng: -97, tier: "nearby", ageDays: null },
        { id: "n2", dealId: null, name: "Near Two", lat: 30.0002, lng: -97, tier: "nearby", ageDays: null },
        { id: "far", dealId: null, name: "Far Co", lat: 30.181, lng: -97, tier: "nearby", ageDays: null },
      ] as FlexibleStop[];
      renderView({ proposal, overflow, origin, remainingMin: 60 });

      const addBtn = () => screen.getByRole("button", { name: /add more stops/i });

      fireEvent.click(addBtn());
      let items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
      expect(items.some((t) => t.includes("Near One"))).toBe(true);
      expect(items.some((t) => t.includes("Near Two"))).toBe(true);
      expect(items.some((t) => t.includes("Far Co"))).toBe(false);

      // Second tap: the far (40-min) stop still cannot fit the depleted budget.
      fireEvent.click(addBtn());
      items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
      expect(items.some((t) => t.includes("Far Co"))).toBe(false);
      // Only the two near stops were ever appended.
      expect(screen.getByText(/added 2 stops to your day\./i)).toBeInTheDocument();
    });

    it("Undo on the fill notice reverses the whole batch and restores the budget/pool so it can re-fill", () => {
      const origin = { lat: 30.0, lng: -97.0 };
      const proposal = [
        { id: "o1", kind: "flexible", tier: "past_due", name: "Owed Co", dealId: "d1", lat: 30.0, lng: -97.0, startAt: null, endAt: null, ageDays: 4 },
      ] as OrderedStop[];
      const overflow = [
        { id: "f1", dealId: null, name: "Fill One", lat: 30.0, lng: -97.0, tier: "nearby", ageDays: null },
        { id: "f2", dealId: null, name: "Fill Two", lat: 30.0, lng: -97.0, tier: "nearby", ageDays: null },
      ] as FlexibleStop[];
      renderView({ proposal, overflow, origin, remainingMin: 300 });

      // A tap folds both candidates in.
      fireEvent.click(screen.getByRole("button", { name: /add more stops/i }));
      expect(screen.getByText(/added 2 stops to your day\./i)).toBeInTheDocument();
      let items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
      expect(items.some((t) => t.includes("Fill One"))).toBe(true);
      expect(items.some((t) => t.includes("Fill Two"))).toBe(true);

      // Undo reverses the entire fill: both filled stops leave the plan, the
      // notice clears, and the committed stop stays.
      fireEvent.click(screen.getByRole("button", { name: /^undo$/i }));
      items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
      expect(items.some((t) => t.includes("Fill One"))).toBe(false);
      expect(items.some((t) => t.includes("Fill Two"))).toBe(false);
      expect(screen.getByText("Owed Co")).toBeInTheDocument();
      expect(screen.queryByText(/to your day\./i)).not.toBeInTheDocument();

      // Budget + pool are restored: a fresh tap re-adds the same candidates.
      fireEvent.click(screen.getByRole("button", { name: /add more stops/i }));
      items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
      expect(items.some((t) => t.includes("Fill One"))).toBe(true);
      expect(items.some((t) => t.includes("Fill Two"))).toBe(true);
      expect(screen.getByText(/added 2 stops to your day\./i)).toBeInTheDocument();
    });

    it("marks filled rows while the notice shows and clears the marker after Undo", () => {
      const origin = { lat: 30.0, lng: -97.0 };
      const proposal = [
        { id: "o1", kind: "flexible", tier: "past_due", name: "Owed Co", dealId: "d1", lat: 30.0, lng: -97.0, startAt: null, endAt: null, ageDays: 4 },
      ] as OrderedStop[];
      const overflow = [
        { id: "f1", dealId: null, name: "Fill One", lat: 30.0, lng: -97.0, tier: "nearby", ageDays: null },
      ] as FlexibleStop[];
      renderView({ proposal, overflow, origin, remainingMin: 300 });

      // Before any fill, no row carries the marker.
      expect(screen.queryByTestId("fill-marker-f1")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /add more stops/i }));
      // The filled row is now marked; the committed (non-fill) row is not.
      const filledRow = screen.getByText("Fill One").closest("li")!;
      expect(within(filledRow).getByTestId("fill-marker-f1")).toBeInTheDocument();
      const owedRow = screen.getByText("Owed Co").closest("li")!;
      expect(within(owedRow).queryByTestId("fill-marker-o1")).not.toBeInTheDocument();

      // Undo clears both the row and its marker.
      fireEvent.click(screen.getByRole("button", { name: /^undo$/i }));
      expect(screen.queryByTestId("fill-marker-f1")).not.toBeInTheDocument();
    });

    it("removing one filled stop via the existing Trash recounts the notice; removing the last clears it", () => {
      const origin = { lat: 30.0, lng: -97.0 };
      const proposal = [
        { id: "o1", kind: "flexible", tier: "past_due", name: "Owed Co", dealId: "d1", lat: 30.0, lng: -97.0, startAt: null, endAt: null, ageDays: 4 },
      ] as OrderedStop[];
      const overflow = [
        { id: "f1", dealId: null, name: "Fill One", lat: 30.0, lng: -97.0, tier: "nearby", ageDays: null },
        { id: "f2", dealId: null, name: "Fill Two", lat: 30.0, lng: -97.0, tier: "nearby", ageDays: null },
      ] as FlexibleStop[];
      renderView({ proposal, overflow, origin, remainingMin: 300 });

      fireEvent.click(screen.getByRole("button", { name: /add more stops/i }));
      expect(screen.getByText(/added 2 stops to your day\./i)).toBeInTheDocument();

      // Drop ONE filled stop via its existing per-row Trash -> notice recounts.
      fireEvent.click(screen.getByRole("button", { name: /remove fill one/i }));
      expect(screen.getByText(/added 1 stop to your day\./i)).toBeInTheDocument();
      expect(screen.queryByText("Fill One")).not.toBeInTheDocument();
      // The remaining filled row is still marked.
      const remaining = screen.getByText("Fill Two").closest("li")!;
      expect(within(remaining).getByTestId("fill-marker-f2")).toBeInTheDocument();

      // Dropping the last filled stop clears the notice entirely.
      fireEvent.click(screen.getByRole("button", { name: /remove fill two/i }));
      expect(screen.queryByText(/to your day\./i)).not.toBeInTheDocument();
    });

    it("Undo after an individual drop reverses only the still-attributable remainder (does not resurrect the dropped one)", () => {
      const origin = { lat: 30.0, lng: -97.0 };
      const proposal = [
        { id: "o1", kind: "flexible", tier: "past_due", name: "Owed Co", dealId: "d1", lat: 30.0, lng: -97.0, startAt: null, endAt: null, ageDays: 4 },
      ] as OrderedStop[];
      const overflow = [
        { id: "f1", dealId: null, name: "Fill One", lat: 30.0, lng: -97.0, tier: "nearby", ageDays: null },
        { id: "f2", dealId: null, name: "Fill Two", lat: 30.0, lng: -97.0, tier: "nearby", ageDays: null },
      ] as FlexibleStop[];
      renderView({ proposal, overflow, origin, remainingMin: 300 });

      fireEvent.click(screen.getByRole("button", { name: /add more stops/i }));
      // Individually drop Fill One first.
      fireEvent.click(screen.getByRole("button", { name: /remove fill one/i }));
      expect(screen.getByText(/added 1 stop to your day\./i)).toBeInTheDocument();

      // Undo reverses only the still-attributable remainder (Fill Two). Fill One
      // stays gone (it was already individually dropped, not resurrected).
      fireEvent.click(screen.getByRole("button", { name: /^undo$/i }));
      const items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
      expect(items.some((t) => t.includes("Fill Two"))).toBe(false);
      expect(items.some((t) => t.includes("Fill One"))).toBe(false);
      expect(screen.queryByText(/to your day\./i)).not.toBeInTheDocument();
      expect(screen.getByText("Owed Co")).toBeInTheDocument();
    });

    it("existing remove-any still works on a non-fill stop (unchanged), with no separate Drop control", () => {
      const origin = { lat: 30.0, lng: -97.0 };
      const proposal = [
        { id: "o1", kind: "flexible", tier: "past_due", name: "Owed Co", dealId: "d1", lat: 30.0, lng: -97.0, startAt: null, endAt: null, ageDays: 4 },
        { id: "due1", kind: "flexible", tier: "due_today", name: "DueToday Co", dealId: "d3", lat: 30.0, lng: -97.0, startAt: null, endAt: null, ageDays: null },
      ] as OrderedStop[];
      const overflow = [
        { id: "f1", dealId: null, name: "Fill One", lat: 30.0, lng: -97.0, tier: "nearby", ageDays: null },
      ] as FlexibleStop[];
      renderView({ proposal, overflow, origin, remainingMin: 300 });

      fireEvent.click(screen.getByRole("button", { name: /add more stops/i }));
      // A non-fill flexible stop is still removable via the existing Trash.
      fireEvent.click(screen.getByRole("button", { name: /remove duetoday co/i }));
      expect(screen.queryByText("DueToday Co")).not.toBeInTheDocument();
      // Removing a non-fill row does not touch the fill count.
      expect(screen.getByText(/added 1 stop to your day\./i)).toBeInTheDocument();
      // No separate "Drop" control was introduced.
      expect(screen.queryByRole("button", { name: /^drop$/i })).not.toBeInTheDocument();
    });

    it("disables the control once the depleted budget drops below a stop's minimum", () => {
      // 35-min budget; three ~15-min near stops. Tap 1 folds in two (30 min),
      // leaving ~5 min: below MIN_STOP_MIN, so the control disables and the
      // third stop never joins.
      const origin = { lat: 30, lng: -97 };
      const proposal = [
        { id: "o1", kind: "flexible", tier: "past_due", name: "Owed Co", dealId: "d1", lat: 30, lng: -97, startAt: null, endAt: null, ageDays: 4 },
      ] as OrderedStop[];
      const overflow = [
        { id: "n1", dealId: null, name: "Near One", lat: 30.0001, lng: -97, tier: "nearby", ageDays: null },
        { id: "n2", dealId: null, name: "Near Two", lat: 30.0002, lng: -97, tier: "nearby", ageDays: null },
        { id: "n3", dealId: null, name: "Near Three", lat: 30.0003, lng: -97, tier: "nearby", ageDays: null },
      ] as FlexibleStop[];
      renderView({ proposal, overflow, origin, remainingMin: 35 });

      fireEvent.click(screen.getByRole("button", { name: /add more stops/i }));

      const addStops = screen.getByRole("button", { name: /add more stops/i });
      expect(addStops).toBeDisabled();
      const items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
      expect(items.some((t) => t.includes("Near Three"))).toBe(false);
      expect(screen.getByText(/added 2 stops to your day\./i)).toBeInTheDocument();
    });
  });
});
