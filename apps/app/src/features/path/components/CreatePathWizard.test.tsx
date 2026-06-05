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
import type { MerchantWithDistance } from "./MerchantList";

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
vi.mock("./MerchantMap", () => ({ MerchantMap: () => <div data-testid="map" /> }));

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

describe("CreatePathWizard radius + max stops + select stops", () => {
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

  it("advances from filters to the Select stops step", () => {
    mockPrefs = { retail: allSubtypes("retail") };
    renderWizard({ merchants: [] });
    fireEvent.click(screen.getByRole("button", { name: /select stops/i }));
    expect(screen.getByRole("button", { name: /start path/i })).toBeInTheDocument();
  });

  it("renders the Select stops step with its dialog title", () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /select stops/i }));
    expect(screen.getByRole("heading", { name: /select stops/i })).toBeInTheDocument();
  });

  it("shows the empty state in Select stops when no businesses match", () => {
    renderWizard({ merchants: [] });
    fireEvent.click(screen.getByRole("button", { name: /select stops/i }));
    expect(screen.getByText(/no businesses match these filters/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start path/i })).toBeDisabled();
  });

  it("offers Opportunity and Distance sort in Select stops", () => {
    mockPrefs = { automotive: allSubtypes("automotive") };
    renderWizard({ merchants: [mkAutoMerchant("a", 0)] });
    fireEvent.click(screen.getByRole("button", { name: /select stops/i }));
    fireEvent.click(screen.getByRole("button", { name: /add nearby/i }));
    expect(screen.getByRole("button", { name: /opportunity/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /distance/i })).toBeInTheDocument();
  });

  it("pre-checks the optimized top-N (= max stops) when entering Select stops", () => {
    mockPrefs = { automotive: allSubtypes("automotive") };
    // 5 matching merchants, Max stops default is 25 → all 5 pre-checked
    const merchants = ["a", "b", "c", "d", "e"].map((id, i) => mkAutoMerchant(id, i));
    renderWizard({ merchants });
    fireEvent.click(screen.getByRole("button", { name: /select stops/i }));
    expect(screen.getByText(/in your route · 5/i)).toBeInTheDocument(); // SelectStops live header
  });

  it("Back returns from Select stops to the filters step", () => {
    mockPrefs = { automotive: allSubtypes("automotive") };
    renderWizard({ merchants: [mkAutoMerchant("a", 0)] });
    fireEvent.click(screen.getByRole("button", { name: /select stops/i }));
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    // filters step is back: the "Your industries" hero + the Select stops advance button
    expect(screen.getByRole("button", { name: /select stops/i })).toBeInTheDocument();
  });

  it("re-seeds the auto-selection when Max stops changes", () => {
    mockPrefs = { automotive: allSubtypes("automotive") };
    const merchants = ["a", "b", "c", "d", "e"].map((id, i) => mkAutoMerchant(id, i));
    renderWizard({ merchants });
    // lower Max stops to 2 → seed re-runs (stopCap dep) → 2 pre-checked
    fireEvent.change(screen.getByLabelText(/max stops/i), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /select stops/i }));
    expect(screen.getByText(/in your route · 2/i)).toBeInTheDocument();
  });
});

// A geocoded, non-chain automotive merchant whose category + primaryType satisfy
// a full "automotive" selection (allSubtypes includes "car_repair"). Deterministic
// distinct lat per index keeps nearest-neighbor ordering stable.
function mkAutoMerchant(id: string, i = 0) {
  return {
    id, name: id, category: "automotive", address: "a", lat: 35 + i * 0.01, lng: -97,
    phone: "", employeeCountRange: "", status: "untouched", lastActivity: null,
    isChain: false, distanceMeters: 100, rating: 4.2, primaryType: "car_repair",
  } as MerchantWithDistance;
}
