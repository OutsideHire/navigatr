import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { SelectStops, routeDescriptor } from "./SelectStops";
import type { MerchantWithDistance } from "./MerchantList";

vi.mock("./MerchantMap", () => ({ MerchantMap: () => <div data-testid="map" /> }));

function row(id: string, over: Partial<MerchantWithDistance> = {}): MerchantWithDistance {
  return {
    id, name: id, category: "automotive", address: "a", lat: 35.0, lng: -97.0,
    phone: "", employeeCountRange: "", status: "untouched", lastActivity: null,
    isChain: false, distanceMeters: 100, rating: 4.2, ...over,
  } as MerchantWithDistance;
}
const ORIGIN = { lat: 35.0, lng: -97.0 };
const POOL = [row("Acme"), row("Bravo"), row("Charlie")];

function setup(selectedIds: Set<string>, props: Partial<React.ComponentProps<typeof SelectStops>> = {}) {
  const onToggle = vi.fn();
  const onStart = vi.fn();
  const onBack = vi.fn();
  render(
    <SelectStops
      pool={POOL} origin={ORIGIN} sortMode="opportunity" onSortChange={vi.fn()}
      selectedIds={selectedIds} onToggle={onToggle} onBack={onBack} onStart={onStart}
      {...props}
    />,
  );
  return { onToggle, onStart, onBack };
}

describe("SelectStops — Confirm route (default)", () => {
  it("shows the map, summary, Start and Edit stops; not the stop list", () => {
    setup(new Set(["Acme", "Bravo"]));
    expect(screen.getByTestId("map")).toBeInTheDocument();
    expect(screen.getByText(/in your route · 2/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start path/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit stops/i })).toBeInTheDocument();
    expect(screen.queryByText("Acme")).not.toBeInTheDocument();
  });
  it("Start fires onStart with the NN-ordered selected ids", () => {
    const { onStart } = setup(new Set(["Acme", "Charlie"]));
    fireEvent.click(screen.getByRole("button", { name: /start path/i }));
    expect((onStart.mock.calls[0][0] as string[]).sort()).toEqual(["Acme", "Charlie"]);
  });
  it("Start disabled + hint when no stops", () => {
    setup(new Set());
    expect(screen.getByRole("button", { name: /start path/i })).toBeDisabled();
    expect(screen.getByText(/no stops yet/i)).toBeInTheDocument();
  });
  it("Back calls onBack", () => {
    const { onBack } = setup(new Set(["Acme"]));
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(onBack).toHaveBeenCalled();
  });
  it("empty pool shows the no-businesses message", () => {
    setup(new Set(), { pool: [] });
    expect(screen.getByText(/no businesses match/i)).toBeInTheDocument();
  });
});

describe("SelectStops — Edit view", () => {
  function openEdit(selectedIds: Set<string>, props = {}) {
    const r = setup(selectedIds, props);
    fireEvent.click(screen.getByRole("button", { name: /edit stops/i }));
    return r;
  }
  it("Edit reveals the route list; Done returns to Confirm", () => {
    openEdit(new Set(["Acme"]));
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add nearby/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^done$/i }));
    expect(screen.getByTestId("map")).toBeInTheDocument();
    expect(screen.queryByText("Acme")).not.toBeInTheDocument();
  });
  it("removing a route row calls onToggle", () => {
    const { onToggle } = openEdit(new Set(["Acme"]));
    fireEvent.click(screen.getByRole("button", { name: /remove acme/i }));
    expect(onToggle).toHaveBeenCalledWith("Acme");
  });
  it("expanding Add nearby and checking a candidate calls onToggle", () => {
    const { onToggle } = openEdit(new Set(["Acme"]));
    fireEvent.click(screen.getByRole("button", { name: /add nearby/i }));
    fireEvent.click(screen.getByLabelText("Charlie"));
    expect(onToggle).toHaveBeenCalledWith("Charlie");
  });
});

describe("routeDescriptor", () => {
  it("names the top two categories", () => {
    expect(routeDescriptor([
      { category: "manufacturing" } as never, { category: "manufacturing" } as never, { category: "automotive" } as never,
    ])).toMatch(/^Mostly /);
  });
  it("uses 'All' for one category and '' for empty", () => {
    expect(routeDescriptor([{ category: "automotive" } as never])).toMatch(/^All /);
    expect(routeDescriptor([])).toBe("");
  });
});
