import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

import { MerchantMap } from "./MerchantMap";
import type { Merchant } from "../mockData";

/**
 * maplibre-gl needs WebGL, which jsdom lacks. Same fake as DayStopsMap.test:
 * `load` fires synchronously and each Marker's element is appended to the
 * container, so the tests can count real marker DOM. fitBounds / flyTo are
 * recorded on the shared registry.
 */
const { mapInstances } = vi.hoisted(() => ({
  mapInstances: [] as Array<{ fitBoundsCalls: unknown[][]; flyToCalls: unknown[] }>,
}));

vi.mock("maplibre-gl", () => {
  class FakeMap {
    container: HTMLElement;
    fitBoundsCalls: unknown[][] = [];
    flyToCalls: unknown[] = [];
    constructor(opts: { container: HTMLElement }) {
      this.container = opts.container;
      mapInstances.push(this);
    }
    on(evt: string, cb: () => void) {
      if (evt === "load") cb();
      return this;
    }
    fitBounds(...args: unknown[]) {
      this.fitBoundsCalls.push(args);
    }
    flyTo(opts: unknown) {
      this.flyToCalls.push(opts);
    }
    getZoom() {
      return 13;
    }
    getSource() {
      return undefined;
    }
    addSource() {}
    addLayer() {}
    remove() {}
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

function m(id: string, lat: number, lng: number): Merchant {
  return { id, name: id, lat, lng, address: "", category: "retail", status: "prospect" } as Merchant;
}

const POS = { lat: 35.65, lng: -97.47 };
const PINS = [m("a", 35.6, -97.5), m("b", 35.7, -97.4), m("c", 35.65, -97.45)];

beforeEach(() => {
  mapInstances.length = 0;
});

function markerCount(container: HTMLElement): number {
  // Every marker element is a direct child div appended into the map container.
  return container.firstElementChild?.childElementCount ?? 0;
}

describe("MerchantMap", () => {
  it("by default shows the rep position marker plus one pin per merchant, and does not fit bounds", () => {
    const { container } = render(<MerchantMap position={POS} merchants={PINS} />);
    expect(markerCount(container)).toBe(4);
    expect(mapInstances[0]!.fitBoundsCalls).toHaveLength(0);
  });

  it("showPosition={false} hides the rep position marker", () => {
    const { container } = render(<MerchantMap position={POS} merchants={PINS} showPosition={false} />);
    expect(markerCount(container)).toBe(3);
  });

  it("fitToMerchants fits the view to the merchant pins", () => {
    render(<MerchantMap position={POS} merchants={PINS} fitToMerchants />);
    const calls = mapInstances[0]!.fitBoundsCalls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls.at(-1)![0]).toEqual([
      [-97.5, 35.6],
      [-97.4, 35.7],
    ]);
  });
});
