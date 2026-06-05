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

describe("SelectStops — map + accordions", () => {
  it("default: map + both section bars + Start + Back; lists collapsed", () => {
    setup(new Set(["Acme", "Bravo"]));
    expect(screen.getByTestId("map")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /in your route · 2/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add nearby/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start path/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^back$/i })).toBeInTheDocument();
    expect(screen.queryByText("Acme")).not.toBeInTheDocument();        // route collapsed
    expect(screen.queryByLabelText("Charlie")).not.toBeInTheDocument(); // add collapsed
  });

  it("expanding 'In your route' shows the numbered stops; removing calls onToggle", () => {
    const { onToggle } = setup(new Set(["Acme"]));
    fireEvent.click(screen.getByRole("button", { name: /in your route/i }));
    expect(screen.getByText("Acme")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /remove acme/i }));
    expect(onToggle).toHaveBeenCalledWith("Acme");
  });

  it("opening 'Add nearby' collapses 'In your route' (accordion) and reveals candidates", () => {
    const { onToggle } = setup(new Set(["Acme"]));
    fireEvent.click(screen.getByRole("button", { name: /in your route/i }));   // open route
    expect(screen.getByText("Acme")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add nearby/i }));      // open add → route closes
    expect(screen.queryByText("Acme")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Bravo")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Charlie"));
    expect(onToggle).toHaveBeenCalledWith("Charlie");
  });

  it("0 selected: Add nearby auto-expanded, Start disabled", () => {
    setup(new Set());
    expect(screen.getByLabelText("Acme")).toBeInTheDocument(); // candidates visible (add auto-open)
    expect(screen.getByRole("button", { name: /start path/i })).toBeDisabled();
  });

  it("Start fires onStart NN-ordered; Back calls onBack", () => {
    const { onStart, onBack } = setup(new Set(["Acme", "Charlie"]));
    fireEvent.click(screen.getByRole("button", { name: /start path/i }));
    expect((onStart.mock.calls[0][0] as string[]).sort()).toEqual(["Acme", "Charlie"]);
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(onBack).toHaveBeenCalled();
  });

  it("empty pool shows the no-businesses message", () => {
    setup(new Set(), { pool: [] });
    expect(screen.getByText(/no businesses match/i)).toBeInTheDocument();
  });
});

describe("routeDescriptor", () => {
  it("names top categories / All / empty", () => {
    expect(routeDescriptor([{ category: "manufacturing" } as never, { category: "manufacturing" } as never, { category: "automotive" } as never])).toMatch(/^Mostly /);
    expect(routeDescriptor([{ category: "automotive" } as never])).toMatch(/^All /);
    expect(routeDescriptor([])).toBe("");
  });
});
