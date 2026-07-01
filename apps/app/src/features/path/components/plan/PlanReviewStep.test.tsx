import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlanReviewStep } from "./PlanReviewStep";
import type { Merchant } from "../../mockData";

function merchant(id: string, name: string): Merchant {
  return {
    id,
    name,
    category: "retail",
    address: "123 Main St",
    lat: 30,
    lng: -97,
    phone: "",
    employeeCountRange: "",
    status: "untouched",
    lastActivity: null,
  };
}

const stops = [merchant("a", "Alpha"), merchant("b", "Beta"), merchant("c", "Gamma")];

function renderStep(props: Partial<React.ComponentProps<typeof PlanReviewStep>> = {}) {
  const defaults: React.ComponentProps<typeof PlanReviewStep> = {
    stops,
    onRemove: vi.fn(),
    onMove: vi.fn(),
    onAddMore: vi.fn(),
  };
  return render(<PlanReviewStep {...defaults} {...props} />);
}

describe("PlanReviewStep", () => {
  it("lists stops in order with position numbers", () => {
    renderStep();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Alpha");
    expect(items[2]).toHaveTextContent("Gamma");
  });

  it("move-up is disabled for the first stop, move-down for the last", () => {
    renderStep();
    expect(screen.getByRole("button", { name: /move alpha up/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /move gamma down/i })).toBeDisabled();
  });

  it("move-down fires onMove(index, 'down')", () => {
    const onMove = vi.fn();
    renderStep({ onMove });
    fireEvent.click(screen.getByRole("button", { name: /move alpha down/i }));
    expect(onMove).toHaveBeenCalledWith(0, "down");
  });

  it("move-up fires onMove(index, 'up')", () => {
    const onMove = vi.fn();
    renderStep({ onMove });
    fireEvent.click(screen.getByRole("button", { name: /move beta up/i }));
    expect(onMove).toHaveBeenCalledWith(1, "up");
  });

  it("remove fires onRemove(id)", () => {
    const onRemove = vi.fn();
    renderStep({ onRemove });
    fireEvent.click(screen.getByRole("button", { name: /remove beta/i }));
    expect(onRemove).toHaveBeenCalledWith("b");
  });

  it('"Add more stops" fires onAddMore', () => {
    const onAddMore = vi.fn();
    renderStep({ onAddMore });
    fireEvent.click(screen.getByRole("button", { name: /add more stops/i }));
    expect(onAddMore).toHaveBeenCalled();
  });

  it("shows the empty state with an add CTA when there are no stops", () => {
    const onAddMore = vi.fn();
    renderStep({ stops: [], onAddMore });
    expect(screen.getByText(/no stops yet/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add stops/i }));
    expect(onAddMore).toHaveBeenCalled();
  });
});
