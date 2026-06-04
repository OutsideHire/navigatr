import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { toast } from "sonner";
import { CreatePathWizard } from "./CreatePathWizard";
import {
  allSubtypes,
  selectedCategories,
  RECOMMENDED_SELECTION,
  type IndustrySelection,
} from "../lib/industrySelection";

// The "Create path" wizard is default-industries-first: step 1 seeds the rep's
// saved default industry selection, shows a "Your industries" summary with an
// Edit affordance (opens IndustryEditor at path scope), and a Min-rating Select.
// No internal taxonomy jargon, and no employee-based filters (Places-only).

const mockMutate = vi.fn();
let mockPrefs: IndustrySelection = RECOMMENDED_SELECTION;
vi.mock("../hooks/usePathPreferences", () => ({
  usePathPreferences: () => ({ data: mockPrefs }),
  useUpdateDefaultIndustries: () => ({ mutate: mockMutate }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

beforeEach(() => {
  mockMutate.mockClear();
  mockPrefs = RECOMMENDED_SELECTION;
});

function renderWizard(
  props: Partial<React.ComponentProps<typeof CreatePathWizard>> = {},
) {
  return render(
    <CreatePathWizard
      open
      onOpenChange={() => {}}
      origin={{ lat: 35, lng: -97 }}
      merchants={[]}
      radiusM={16093}
      onRadiusChange={() => {}}
      onIndustriesChange={vi.fn()}
      onStart={vi.fn()}
      {...props}
    />,
  );
}

describe("CreatePathWizard step 1 — default-industries-first", () => {
  it("speaks the rep's language — no internal taxonomy jargon", () => {
    renderWizard();
    expect(screen.queryByText(/tier 1/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/tier-1/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/default \(tier/i)).not.toBeInTheDocument();
  });

  it("seeds 'Your industries' from saved preferences and lifts the categories", () => {
    mockPrefs = { retail: allSubtypes("retail"), automotive: allSubtypes("automotive") };
    const onIndustriesChange = vi.fn();
    renderWizard({ onIndustriesChange });
    expect(screen.getByText(/your industries/i)).toBeInTheDocument();
    expect(screen.getByText(/retail/i)).toBeInTheDocument();
    expect(screen.getByText(/automotive/i)).toBeInTheDocument();
    expect(onIndustriesChange).toHaveBeenCalledWith(
      expect.arrayContaining(selectedCategories(mockPrefs)),
    );
  });

  it("shows a Min rating control and not a Min employees control", () => {
    renderWizard();
    expect(screen.getByLabelText(/min rating/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/min employees/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/min employees/i)).not.toBeInTheDocument();
  });

  it("Edit opens the IndustryEditor; Use for this path applies the selection", () => {
    mockPrefs = { retail: allSubtypes("retail") };
    const onIndustriesChange = vi.fn();
    renderWizard({ onIndustriesChange });
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(screen.getByRole("button", { name: /use for this path/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save as default/i })).toBeInTheDocument();
    onIndustriesChange.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /use for this path/i }));
    expect(screen.queryByRole("button", { name: /use for this path/i })).not.toBeInTheDocument();
    expect(onIndustriesChange).toHaveBeenCalled();
  });

  it("Save as default persists via the mutation", () => {
    mockPrefs = { retail: allSubtypes("retail") };
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.click(screen.getByRole("button", { name: /save as default/i }));
    expect(mockMutate).toHaveBeenCalled();
  });

  it("shows a toast if saving the default fails", () => {
    mockPrefs = { retail: allSubtypes("retail") };
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.click(screen.getByRole("button", { name: /save as default/i }));
    // invoke the onError passed to mutate(sel, { onError })
    const opts = mockMutate.mock.calls[0][1];
    opts.onError(new Error("network"));
    expect(toast.error).toHaveBeenCalled();
  });
});

describe("CreatePathWizard radius + max stops + preview", () => {
  it("reflects the current radius and drives onRadiusChange", () => {
    const onRadiusChange = vi.fn();
    renderWizard({ radiusM: 16093, onRadiusChange });
    const tenMile = screen.getByRole("button", { name: "10 mi" });
    expect(tenMile).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "5 mi" }));
    expect(onRadiusChange).toHaveBeenCalledWith(8047);
  });

  it("has a Max stops field defaulting to 25", () => {
    renderWizard();
    expect(screen.getByLabelText(/max stops/i)).toHaveValue(25);
  });

  it("advances to the preview step on Preview route", () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /preview route/i }));
    expect(screen.getByText(/route preview/i)).toBeInTheDocument();
    expect(screen.getByText(/stops/i)).toBeInTheDocument();
  });

  it("shows the empty state in preview when no businesses match", () => {
    renderWizard({ merchants: [] });
    fireEvent.click(screen.getByRole("button", { name: /preview route/i }));
    expect(screen.getByText(/no businesses match these filters/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start path/i })).toBeDisabled();
  });

  it("offers Opportunity and Distance sort in preview", () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /preview route/i }));
    expect(screen.getByRole("button", { name: /opportunity/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /distance/i })).toBeInTheDocument();
  });
});
