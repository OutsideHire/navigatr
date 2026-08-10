import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PathOverflowSheet } from "./PathOverflowSheet";

const base = {
  open: true,
  onOpenChange: vi.fn(),
  onAddMoreStops: vi.fn(),
  onPlanNewArea: vi.fn(),
  onFindNearby: vi.fn(),
};

describe("PathOverflowSheet", () => {
  it("renders the header copy and the three actions plus Cancel when open", () => {
    render(<PathOverflowSheet {...base} />);
    expect(
      screen.getByText(/These are here when you need them\. Most days you will not\./i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add more stops today/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /plan a new area/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /who's near me right now/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeInTheDocument();
  });

  it("Add more stops today fires its handler and closes the sheet", () => {
    const onAddMoreStops = vi.fn();
    const onOpenChange = vi.fn();
    render(<PathOverflowSheet {...base} onAddMoreStops={onAddMoreStops} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: /add more stops today/i }));
    expect(onAddMoreStops).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Plan a new area fires its handler and closes the sheet", () => {
    const onPlanNewArea = vi.fn();
    const onOpenChange = vi.fn();
    render(<PathOverflowSheet {...base} onPlanNewArea={onPlanNewArea} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: /plan a new area/i }));
    expect(onPlanNewArea).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Who's near me right now fires its handler and closes the sheet", () => {
    const onFindNearby = vi.fn();
    const onOpenChange = vi.fn();
    render(<PathOverflowSheet {...base} onFindNearby={onFindNearby} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: /who's near me right now/i }));
    expect(onFindNearby).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Cancel closes without firing an action", () => {
    const onAddMoreStops = vi.fn();
    const onPlanNewArea = vi.fn();
    const onFindNearby = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <PathOverflowSheet
        {...base}
        onAddMoreStops={onAddMoreStops}
        onPlanNewArea={onPlanNewArea}
        onFindNearby={onFindNearby}
        onOpenChange={onOpenChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onAddMoreStops).not.toHaveBeenCalled();
    expect(onPlanNewArea).not.toHaveBeenCalled();
    expect(onFindNearby).not.toHaveBeenCalled();
  });
});
