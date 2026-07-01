import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlanSearchStep } from "./PlanSearchStep";
import { RECOMMENDED_SELECTION } from "../../lib/industrySelection";

function renderStep(props: Partial<React.ComponentProps<typeof PlanSearchStep>> = {}) {
  const defaults: React.ComponentProps<typeof PlanSearchStep> = {
    originResolved: false,
    originLabel: null,
    onSearch: vi.fn(),
    searching: false,
    searchError: null,
    radiusM: 8047,
    onRadiusChange: vi.fn(),
    minEmployees: 0,
    onMinEmployeesChange: vi.fn(),
    selection: RECOMMENDED_SELECTION,
    onSelectionChange: vi.fn(),
    allIndustries: false,
    onAllIndustriesChange: vi.fn(),
  };
  const merged = { ...defaults, ...props };
  return { ...render(<PlanSearchStep {...merged} />), props: merged };
}

describe("PlanSearchStep", () => {
  it("submitting the location search calls onSearch with the query", () => {
    const onSearch = vi.fn();
    renderStep({ onSearch });
    fireEvent.change(screen.getByLabelText(/search by city or zip/i), {
      target: { value: "Austin, TX" },
    });
    fireEvent.submit(screen.getByLabelText(/search by city or zip/i).closest("form")!);
    expect(onSearch).toHaveBeenCalledWith("Austin, TX");
  });

  it("shows the resolved-origin banner once an origin resolves", () => {
    renderStep({ originResolved: true, originLabel: "Austin, TX" });
    expect(screen.getByText(/searching near/i)).toBeInTheDocument();
    expect(screen.getByText("Austin, TX")).toBeInTheDocument();
  });

  it("changing radius lifts the new meters", () => {
    const onRadiusChange = vi.fn();
    renderStep({ onRadiusChange });
    fireEvent.click(screen.getByRole("button", { name: "10 mi" }));
    expect(onRadiusChange).toHaveBeenCalledWith(16093);
  });

  it("toggling All business types lifts the flag and hides industry chips", () => {
    const onAllIndustriesChange = vi.fn();
    renderStep({ onAllIndustriesChange });
    fireEvent.click(screen.getByLabelText(/all business types/i));
    expect(onAllIndustriesChange).toHaveBeenCalledWith(true);
  });

  it("shows the every-business message when allIndustries is on", () => {
    renderStep({ allIndustries: true });
    expect(screen.getByText(/every business type nearby is included/i)).toBeInTheDocument();
  });
});
