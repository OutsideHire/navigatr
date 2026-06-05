import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { SelectStops } from "./SelectStops";
import type { MerchantWithDistance } from "./MerchantList";

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
  render(
    <SelectStops
      pool={POOL} origin={ORIGIN} sortMode="opportunity" onSortChange={vi.fn()}
      selectedIds={selectedIds} onToggle={onToggle} onBack={vi.fn()} onStart={onStart}
      {...props}
    />,
  );
  return { onToggle, onStart };
}

describe("SelectStops (route-first)", () => {
  it("shows the route count + distance/ETA in the summary", () => {
    setup(new Set(["Acme", "Bravo"]));
    expect(screen.getByText(/in your route · 2/i)).toBeInTheDocument();
  });

  it("renders selected stops as numbered route rows (no expand needed)", () => {
    setup(new Set(["Acme"]));
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove acme/i })).toBeInTheDocument();
  });

  it("removing a route row calls onToggle with its id", () => {
    const { onToggle } = setup(new Set(["Acme"]));
    fireEvent.click(screen.getByRole("button", { name: /remove acme/i }));
    expect(onToggle).toHaveBeenCalledWith("Acme");
  });

  it("Add nearby is collapsed by default; candidates hidden until expanded", () => {
    setup(new Set(["Acme"]));
    expect(screen.queryByLabelText("Bravo")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add nearby/i }));
    expect(screen.getByLabelText("Bravo")).toBeInTheDocument();
  });

  it("checking a candidate in Add nearby calls onToggle with its id", () => {
    const { onToggle } = setup(new Set(["Acme"]));
    fireEvent.click(screen.getByRole("button", { name: /add nearby/i }));
    fireEvent.click(screen.getByLabelText("Charlie"));
    expect(onToggle).toHaveBeenCalledWith("Charlie");
  });

  it("empty route shows a hint and auto-expands Add nearby", () => {
    setup(new Set());
    expect(screen.getByText(/no stops in your route yet/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Acme")).toBeInTheDocument();
  });

  it("search filters the candidate list", () => {
    setup(new Set());
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "Brav" } });
    expect(screen.getByLabelText("Bravo")).toBeInTheDocument();
    expect(screen.queryByLabelText("Charlie")).not.toBeInTheDocument();
  });

  it("Start disabled at 0", () => {
    setup(new Set());
    expect(screen.getByRole("button", { name: /start path/i })).toBeDisabled();
  });

  it("Start fires onStart with the NN-ordered selected ids", () => {
    const { onStart } = setup(new Set(["Acme", "Charlie"]));
    fireEvent.click(screen.getByRole("button", { name: /start path/i }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect((onStart.mock.calls[0][0] as string[]).sort()).toEqual(["Acme", "Charlie"]);
  });

  it("empty pool shows the no-businesses message", () => {
    setup(new Set(), { pool: [] });
    expect(screen.getByText(/no businesses match/i)).toBeInTheDocument();
  });
});
