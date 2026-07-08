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
      resultsCount={25}
      onResultsCountChange={vi.fn()}
      onIndustriesChange={vi.fn()}
      onAllIndustriesChange={vi.fn()}
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

  it("All industries toggle lifts allIndustries and overrides bucket selection", () => {
    mockPrefs = { automotive: allSubtypes("automotive") };
    const onAllIndustriesChange = vi.fn();
    renderWizard({ onAllIndustriesChange });
    // Seeded bucket pill shows initially.
    expect(screen.getByText("Automotive")).toBeInTheDocument();
    const toggle = screen.getByRole("checkbox", { name: /all industries/i });
    fireEvent.click(toggle);
    expect(onAllIndustriesChange).toHaveBeenCalledWith(true);
    expect(screen.getByText(/every business type nearby/i)).toBeInTheDocument();
    expect(screen.queryByText("Automotive")).not.toBeInTheDocument();
    // Turning it off restores the bucket selection.
    fireEvent.click(toggle);
    expect(onAllIndustriesChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByText("Automotive")).toBeInTheDocument();
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

  it("renders a Results count field (separate from Max stops) reflecting the prop", () => {
    renderWizard({ resultsCount: 40 });
    const results = screen.getByLabelText(/^results$/i);
    expect(results).toHaveValue(40);
    // The stop cap is a distinct control that stays at its own default.
    expect(screen.getByLabelText(/max stops/i)).toHaveValue(25);
  });

  it("calls onResultsCountChange (clamped to 50) when the results count changes", () => {
    const onResultsCountChange = vi.fn();
    renderWizard({ resultsCount: 25, onResultsCountChange });
    const results = screen.getByLabelText(/^results$/i);
    fireEvent.change(results, { target: { value: "40" } });
    expect(onResultsCountChange).toHaveBeenCalledWith(40);
    fireEvent.change(results, { target: { value: "99" } });
    expect(onResultsCountChange).toHaveBeenCalledWith(50);
  });

  it("advances from filters to the Select stops step", () => {
    mockPrefs = { retail: allSubtypes("retail") };
    renderWizard({ merchants: [] });
    fireEvent.click(screen.getByRole("button", { name: /select stops/i }));
    expect(screen.getByRole("button", { name: /review route/i })).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: /review route/i })).toBeDisabled();
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

  it("Review route advances from Select stops to the Optimized route preview", () => {
    mockPrefs = { automotive: allSubtypes("automotive") };
    renderWizard({ merchants: [mkAutoMerchant("a", 0)] });
    fireEvent.click(screen.getByRole("button", { name: /select stops/i }));
    fireEvent.click(screen.getByRole("button", { name: /review route/i }));
    expect(screen.getByRole("heading", { name: /optimized route preview/i })).toBeInTheDocument();
  });

  it("preview Start path fires onStart with the ordered ids", () => {
    mockPrefs = { automotive: allSubtypes("automotive") };
    const onStart = vi.fn();
    renderWizard({ merchants: [mkAutoMerchant("a", 0)], onStart });
    fireEvent.click(screen.getByRole("button", { name: /select stops/i }));
    fireEvent.click(screen.getByRole("button", { name: /review route/i }));
    fireEvent.click(screen.getByRole("button", { name: /start path/i }));
    expect(onStart).toHaveBeenCalledWith(["a"]);
  });

  it("Back from the preview returns to Select stops", () => {
    mockPrefs = { automotive: allSubtypes("automotive") };
    renderWizard({ merchants: [mkAutoMerchant("a", 0)] });
    fireEvent.click(screen.getByRole("button", { name: /select stops/i }));
    fireEvent.click(screen.getByRole("button", { name: /review route/i }));
    expect(screen.getByRole("heading", { name: /optimized route preview/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(screen.getByRole("heading", { name: /select stops/i })).toBeInTheDocument();
  });
});

describe("CreatePathWizard preview — time-aware timeline", () => {
  // A mappable calendar meeting for today. scheduleDay clamps to the day window
  // (08:00–18:00 local), so pick a mid-day local time and build ISO from it.
  function isoForToday(hhmm: string): string {
    const [h, m] = hhmm.split(":").map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  }

  function calendarWaypoint() {
    return {
      id: "wp-1",
      title: "Acme HQ demo",
      start: isoForToday("13:00"),
      end: isoForToday("14:00"),
      address: "1 Acme Way",
      lat: 35.05,
      lng: -97,
      source: "calendar" as const,
    };
  }

  it("shows the time-aware timeline in preview when the day has calendar meetings", () => {
    mockPrefs = { automotive: allSubtypes("automotive") };
    // One selected prospect + one fixed meeting → the optimizer schedules the
    // prospect around the meeting and PathTimeline renders both rows.
    renderWizard({
      merchants: [mkAutoMerchant("a", 0)],
      calendarWaypoints: [calendarWaypoint()],
    });
    fireEvent.click(screen.getByRole("button", { name: /select stops/i }));
    fireEvent.click(screen.getByRole("button", { name: /review route/i }));
    expect(screen.getByRole("heading", { name: /optimized route preview/i })).toBeInTheDocument();
    // The fixed meeting row (waypoint) and its "Meeting" tag from PathTimeline.
    expect(screen.getByText("Acme HQ demo")).toBeInTheDocument();
    expect(screen.getByText("Meeting")).toBeInTheDocument();
    // The selected prospect ("a") appears as a scheduled timeline row.
    expect(screen.getByText("a")).toBeInTheDocument();
  });

  it("shows the plain ordered list (no timeline) when there are no calendar meetings", () => {
    mockPrefs = { automotive: allSubtypes("automotive") };
    // Default: calendarWaypoints/calendarTimeBlocks both empty → existing preview.
    renderWizard({ merchants: [mkAutoMerchant("a", 0)] });
    fireEvent.click(screen.getByRole("button", { name: /select stops/i }));
    fireEvent.click(screen.getByRole("button", { name: /review route/i }));
    expect(screen.getByRole("heading", { name: /optimized route preview/i })).toBeInTheDocument();
    // The prospect is listed as a plain numbered stop; no "Meeting" timeline tag.
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.queryByText("Meeting")).not.toBeInTheDocument();
  });
});

describe("CreatePathWizard step 1 — When (time-window) picker", () => {
  // Derive the local "today" the same way the component does, so the date
  // assertions are tz-agnostic (no faked timers needed).
  function isoForToday(hhmm: string): string {
    const [h, m] = hhmm.split(":").map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  }
  function localHHMM(iso: string): string {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function localDateKey(iso: string): string {
    const d = new Date(iso);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }
  const todayKey = localDateKey(isoForToday("08:00"));

  it("renders Start and End time inputs defaulting to 08:00 / 18:00", () => {
    renderWizard();
    expect(screen.getByLabelText(/^start$/i)).toHaveValue("08:00");
    expect(screen.getByLabelText(/^end$/i)).toHaveValue("18:00");
  });

  it("emits ISO start/end for today on mount", () => {
    const onWindowChange = vi.fn();
    renderWizard({ onWindowChange });
    expect(onWindowChange).toHaveBeenCalled();
    const { start, end } = onWindowChange.mock.calls.at(-1)![0];
    expect(localHHMM(start)).toBe("08:00");
    expect(localHHMM(end)).toBe("18:00");
    expect(localDateKey(start)).toBe(todayKey);
    expect(localDateKey(end)).toBe(todayKey);
  });

  it("changing a time calls onWindowChange with ISO strings matching the inputs and today's date", () => {
    const onWindowChange = vi.fn();
    renderWizard({ onWindowChange });
    fireEvent.change(screen.getByLabelText(/^start$/i), { target: { value: "09:30" } });
    const { start, end } = onWindowChange.mock.calls.at(-1)![0];
    expect(localHHMM(start)).toBe("09:30");
    expect(localHHMM(end)).toBe("18:00");
    expect(localDateKey(start)).toBe(todayKey);
    expect(localDateKey(end)).toBe(todayKey);
  });

  it("clamps end to start + 1h when end <= start (and updates the field)", () => {
    const onWindowChange = vi.fn();
    renderWizard({ onWindowChange });
    fireEvent.change(screen.getByLabelText(/^end$/i), { target: { value: "07:00" } });
    // Start is 08:00 → end clamps to 09:00 in the field.
    expect(screen.getByLabelText(/^end$/i)).toHaveValue("09:00");
    const { start, end } = onWindowChange.mock.calls.at(-1)![0];
    expect(localHHMM(start)).toBe("08:00");
    expect(localHHMM(end)).toBe("09:00");
    // Emitted end is exactly one hour after start.
    expect(new Date(end).getTime() - new Date(start).getTime()).toBe(60 * 60 * 1000);
  });

  it("renders and works without onWindowChange", () => {
    expect(() => renderWizard()).not.toThrow();
    expect(() =>
      fireEvent.change(screen.getByLabelText(/^start$/i), { target: { value: "10:00" } }),
    ).not.toThrow();
    expect(screen.getByLabelText(/^start$/i)).toHaveValue("10:00");
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
