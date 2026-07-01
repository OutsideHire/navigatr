import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlanResultsStep } from "./PlanResultsStep";
import type { MerchantWithDistance } from "../MerchantList";

function merchant(id: string, name: string): MerchantWithDistance {
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
    distanceMeters: 500,
  };
}

function renderStep(props: Partial<React.ComponentProps<typeof PlanResultsStep>> = {}) {
  const defaults: React.ComponentProps<typeof PlanResultsStep> = {
    merchants: [merchant("a", "Alpha Cafe"), merchant("b", "Beta Bakery")],
    isLoading: false,
    isError: false,
    onRetry: vi.fn(),
    addedIds: new Set<string>(),
    onToggleStop: vi.fn(),
    onLogDropIn: vi.fn(),
  };
  return render(<PlanResultsStep {...defaults} {...props} />);
}

describe("PlanResultsStep", () => {
  it("renders a card per merchant", () => {
    renderStep();
    expect(screen.getByText("Alpha Cafe")).toBeInTheDocument();
    expect(screen.getByText("Beta Bakery")).toBeInTheDocument();
  });

  it("shows status, phone, and last-activity details on each card", () => {
    renderStep({
      merchants: [
        {
          ...merchant("a", "Alpha Cafe"),
          status: "prospect",
          phone: "+14055551234",
          lastActivity: "2026-06-01T00:00:00Z",
        },
        { ...merchant("b", "Beta Bakery") }, // untouched, no phone, never contacted
      ],
    });
    // Status pill + formatted phone + dated last-activity for the populated card.
    expect(screen.getByText(/prospect/i)).toBeInTheDocument();
    expect(screen.getByText(/\(405\) 555-1234/)).toBeInTheDocument();
    expect(screen.getByText(/last contact/i)).toBeInTheDocument();
    // Untouched card with no history reads "Never contacted".
    expect(screen.getByText(/never contacted/i)).toBeInTheDocument();
  });

  it('"Add to today\'s path" toggles the merchant into the stop set', () => {
    const onToggleStop = vi.fn();
    renderStep({ onToggleStop });
    fireEvent.click(screen.getAllByRole("button", { name: /add to today's path/i })[0]!);
    expect(onToggleStop).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("shows Added state for merchants already in the set", () => {
    renderStep({ addedIds: new Set(["a"]) });
    const addedBtn = screen.getByRole("button", { name: /^added$/i });
    expect(addedBtn).toHaveAttribute("aria-pressed", "true");
    // The still-unadded merchant keeps the add affordance.
    expect(screen.getByRole("button", { name: /add to today's path/i })).toBeInTheDocument();
  });

  it('"Log drop-in" opens the sheet for that merchant', () => {
    const onLogDropIn = vi.fn();
    renderStep({ onLogDropIn });
    fireEvent.click(screen.getAllByRole("button", { name: /log drop-in/i })[0]!);
    expect(onLogDropIn).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("renders the loading state", () => {
    renderStep({ isLoading: true, merchants: [] });
    expect(screen.getByText(/discovering businesses nearby/i)).toBeInTheDocument();
  });

  it("renders the error state with a retry", () => {
    const onRetry = vi.fn();
    renderStep({ isError: true, merchants: [], onRetry });
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("renders the empty state when there are no matches", () => {
    renderStep({ merchants: [] });
    expect(screen.getByText(/no businesses match/i)).toBeInTheDocument();
  });
});
