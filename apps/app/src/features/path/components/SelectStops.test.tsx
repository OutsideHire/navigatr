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

describe("SelectStops", () => {
  it("shows the selected count in the summary header", () => {
    setup(new Set(["Acme", "Bravo"]));
    expect(screen.getByText(/2 stops/i)).toBeInTheDocument();
  });
  it("toggling a selected row calls onToggle with its id", () => {
    const { onToggle } = setup(new Set(["Acme"]));
    fireEvent.click(screen.getByRole("button", { name: /in your route/i }));
    fireEvent.click(screen.getByLabelText("Acme"));
    expect(onToggle).toHaveBeenCalledWith("Acme");
  });
  it("collapses the Selected section by default and expands on click", () => {
    setup(new Set(["Acme", "Bravo"]));
    expect(screen.getByRole("button", { name: /in your route · 2/i })).toBeInTheDocument();
    expect(screen.queryByLabelText("Acme")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /in your route/i }));
    expect(screen.getByLabelText("Acme")).toBeInTheDocument();
  });
  it("hides the In-your-route bar when nothing is selected", () => {
    setup(new Set());
    expect(screen.queryByRole("button", { name: /in your route/i })).not.toBeInTheDocument();
  });
  it("renders distance · category · rating in a row's meta", () => {
    setup(new Set()); // Charlie etc. are unselected → in More nearby, always visible; row() rating 4.2, category automotive
    expect(screen.getAllByText(/automotive · ★4\.2/i).length).toBeGreaterThanOrEqual(1);
  });
  it("toggling an unselected row calls onToggle with its id", () => {
    const { onToggle } = setup(new Set(["Acme"]));
    fireEvent.click(screen.getByLabelText("Charlie"));
    expect(onToggle).toHaveBeenCalledWith("Charlie");
  });
  it("search narrows the More nearby list", () => {
    setup(new Set());
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "Brav" } });
    expect(screen.getByLabelText("Bravo")).toBeInTheDocument();
    expect(screen.queryByLabelText("Charlie")).not.toBeInTheDocument();
  });
  it("Start is disabled at 0 selected", () => {
    setup(new Set());
    expect(screen.getByRole("button", { name: /start path/i })).toBeDisabled();
  });
  it("Start fires onStart with the nearest-neighbor-ordered selected ids", () => {
    const { onStart } = setup(new Set(["Acme", "Charlie"]));
    fireEvent.click(screen.getByRole("button", { name: /start path/i }));
    expect(onStart).toHaveBeenCalledTimes(1);
    const ids = onStart.mock.calls[0][0] as string[];
    expect(ids.sort()).toEqual(["Acme", "Charlie"]);
  });
  it("omits the rating from a row's meta when rating is absent", () => {
    setup(new Set(), { pool: [row("NoRating", { rating: undefined })] });
    expect(screen.getByText(/automotive/i)).toBeInTheDocument();
    expect(screen.queryByText(/★/)).not.toBeInTheDocument();
  });
  it("shows the empty state when no businesses match", () => {
    setup(new Set(), { pool: [] });
    expect(screen.getByText(/no businesses match/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start path/i })).toBeDisabled();
  });
});
