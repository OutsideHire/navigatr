import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import { DayStopsMap } from "./DayStopsMap";
import type { OrderedStop } from "../lib/todaysPath";

/**
 * maplibre-gl needs a real WebGL context, which jsdom does not provide, so we
 * mock it the way MerchantMap's consumers avoid the real map. The fake Map fires
 * `load` synchronously (so the marker effects run) and appends each Marker's DOM
 * element into the container — that lets us assert the numbered pins, the "You"
 * rep marker, and pin-click wiring against real DOM the component created.
 *
 * The classes live inside the vi.mock factory (which is hoisted above imports);
 * the shared instance registry is created with vi.hoisted so the tests can read
 * it to assert the map is created once and never torn down on re-render.
 */
const { mapInstances } = vi.hoisted(() => ({
  mapInstances: [] as Array<{ removed: boolean; resizeCalls: number }>,
}));

vi.mock("maplibre-gl", () => {
  class FakeMap {
    container: HTMLElement;
    removed = false;
    resizeCalls = 0;
    constructor(opts: { container: HTMLElement }) {
      this.container = opts.container;
      mapInstances.push(this);
    }
    on(evt: string, cb: () => void) {
      if (evt === "load") cb(); // synchronous so styleLoaded flips during mount
      return this;
    }
    resize() {
      this.resizeCalls++;
    }
    remove() {
      this.removed = true;
    }
  }
  class FakeMarker {
    private el: HTMLElement | undefined;
    constructor(opts?: { element?: HTMLElement }) {
      this.el = opts?.element;
    }
    setLngLat() {
      return this;
    }
    addTo(map: FakeMap) {
      if (this.el) map.container.appendChild(this.el);
      return this;
    }
    remove() {
      this.el?.remove();
      return this;
    }
  }
  class FakePopup {
    setLngLat() {
      return this;
    }
    setText() {
      return this;
    }
    addTo() {
      return this;
    }
    remove() {
      return this;
    }
  }
  return { default: { Map: FakeMap, Marker: FakeMarker, Popup: FakePopup } };
});

function stop(partial: Partial<OrderedStop> & Pick<OrderedStop, "id">): OrderedStop {
  return {
    id: partial.id,
    kind: partial.kind ?? "flexible",
    tier: partial.tier ?? "nearby",
    name: partial.name ?? partial.id,
    dealId: partial.dealId ?? null,
    // `in` (not `??`) so an explicit null coordinate is preserved.
    lat: "lat" in partial ? (partial.lat ?? null) : 30.26,
    lng: "lng" in partial ? (partial.lng ?? null) : -97.74,
    startAt: partial.startAt ?? null,
    endAt: partial.endAt ?? null,
    ageDays: partial.ageDays ?? null,
  };
}

const origin = { lat: 30.2672, lng: -97.7431 };

beforeEach(() => {
  mapInstances.length = 0;
  cleanup();
});

describe("DayStopsMap", () => {
  it("renders the aging + appointment legend", () => {
    render(<DayStopsMap stops={[stop({ id: "a" })]} origin={origin} onStopClick={vi.fn()} />);
    expect(screen.getByText("On time")).toBeInTheDocument();
    expect(screen.getByText("Past due")).toBeInTheDocument();
    expect(screen.getByText("Well past due")).toBeInTheDocument();
    expect(screen.getByText("Ring = appointment")).toBeInTheDocument();
  });

  it("renders one numbered pin per routable stop plus the labeled rep marker", () => {
    render(
      <DayStopsMap
        stops={[
          stop({ id: "appt", tier: "appointment", kind: "appointment" }),
          stop({ id: "overdue", tier: "past_due", ageDays: 9 }),
          stop({ id: "no-coord", lat: null, lng: null }),
        ]}
        origin={origin}
        onStopClick={vi.fn()}
      />,
    );
    const pins = screen.getAllByTestId("day-stop-pin");
    // Two routable stops -> pins numbered 1 and 2; the null-coord stop is dropped.
    expect(pins).toHaveLength(2);
    expect(pins.map((p) => p.textContent)).toEqual(["1", "2"]);
    // Appointment pin carries the ring shape signifier, not a color difference.
    expect(pins[0].getAttribute("aria-label")).toContain("appointment");
    expect(pins[1].getAttribute("aria-label")).not.toContain("appointment");
    // The rep marker is present and distinctly labeled.
    expect(screen.getByText("You")).toBeInTheDocument();
  });

  it("fires onStopClick with the stop id when a pin is tapped", () => {
    const onStopClick = vi.fn();
    render(
      <DayStopsMap
        stops={[stop({ id: "s1" }), stop({ id: "s2" })]}
        origin={origin}
        onStopClick={onStopClick}
      />,
    );
    fireEvent.click(screen.getAllByTestId("day-stop-pin")[1]);
    expect(onStopClick).toHaveBeenCalledWith("s2");
  });

  it("does not re-create the map when re-rendered (retention across toggles)", () => {
    const { rerender } = render(
      <DayStopsMap stops={[stop({ id: "a" })]} origin={origin} onStopClick={vi.fn()} />,
    );
    expect(mapInstances).toHaveLength(1);
    // A prop-only re-render (what a CSS show/hide toggle looks like) must not
    // spin up a second map or tear down the first.
    rerender(<DayStopsMap stops={[stop({ id: "a" }), stop({ id: "b" })]} origin={origin} onStopClick={vi.fn()} />);
    expect(mapInstances).toHaveLength(1);
    expect(mapInstances[0].removed).toBe(false);
  });

  it("resizes on the hidden -> shown transition, and not on mount", () => {
    // Mount as the active view: no resize should fire on mount (the container
    // already has its box), so the create-once path stays clean.
    const { rerender } = render(
      <DayStopsMap stops={[stop({ id: "a" })]} origin={origin} onStopClick={vi.fn()} active />,
    );
    expect(mapInstances[0].resizeCalls).toBe(0);

    // Hide it (List view), then show it again (Map view). The false -> true edge
    // must resize the retained map so it is not stuck at zero size.
    rerender(<DayStopsMap stops={[stop({ id: "a" })]} origin={origin} onStopClick={vi.fn()} active={false} />);
    expect(mapInstances[0].resizeCalls).toBe(0);
    rerender(<DayStopsMap stops={[stop({ id: "a" })]} origin={origin} onStopClick={vi.fn()} active />);
    expect(mapInstances[0].resizeCalls).toBeGreaterThanOrEqual(1);
    // Still the same single retained instance.
    expect(mapInstances).toHaveLength(1);
  });
});
