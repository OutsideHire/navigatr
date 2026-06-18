import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { computeKpis, PipelinePage } from "./PipelinePage";
import type { Deal } from "../mockData";
import { MOCK_DEALS } from "../mockData";

// This project's vitest env doesn't ship a fully-functional jsdom
// localStorage; usePersistedViewMode reads it on mount. Install a small
// in-memory shim so the page renders (mirrors CookieBanner.test.tsx).
// We also install the pointer-capture / scrollIntoView polyfills that
// Radix Popover + Select need to open in jsdom (mirrors
// PipelineFilterPopover.test.tsx + DealDetailPage.stage-picker.test.tsx).
beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    value: {
      get length() { return store.size; },
      clear() { store.clear(); },
      getItem(key: string) { return store.has(key) ? store.get(key)! : null; },
      key(i: number) { return Array.from(store.keys())[i] ?? null; },
      removeItem(key: string) { store.delete(key); },
      setItem(key: string, value: string) { store.set(key, value); },
    },
    writable: true,
    configurable: true,
  });
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  }
});

// Mutable dataset the useDeals mock returns. Defaults to MOCK_DEALS so the
// existing subhead/KPI/card tests are unchanged; individual tests can
// override it (e.g. the filter test below) and afterEach restores it.
let mockDeals: Deal[] = MOCK_DEALS;
afterEach(() => {
  mockDeals = MOCK_DEALS;
});

vi.mock("../hooks/useDeals", () => ({
  useDeals: () => ({ data: mockDeals, isLoading: false }),
}));
vi.mock("@/features/profession/useTerm", () => ({
  useTerm: (k: string) => k,
  useTermCapitalized: (k: string) => k.charAt(0).toUpperCase() + k.slice(1),
}));

function d(over: Partial<Deal>): Deal {
  return { ...MOCK_DEALS[0], ...over };
}

describe("computeKpis", () => {
  it("sums open-stage pipeline + weighted and counts active deals", () => {
    const deals = [
      d({ id: "a", stage: "new", valueCents: 100_00, probability: 20 }),
      d({ id: "b", stage: "qualified", valueCents: 200_00, probability: 50 }),
      d({ id: "c", stage: "won", valueCents: 999_00, probability: 100 }),
    ];
    const k = computeKpis(deals);
    expect(k.activeDeals).toBe(2);
    expect(k.totalPipeline).toBe(300_00);
    expect(k.weighted).toBe(100_00 * 0.2 + 200_00 * 0.5);
  });

  it("returns zeros for an empty list", () => {
    expect(computeKpis([])).toEqual(
      expect.objectContaining({ totalPipeline: 0, weighted: 0, activeDeals: 0 }),
    );
  });

  it("counts won deals closed this month and excludes prior-month wins", () => {
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 2).toISOString();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15).toISOString();
    const deals = [
      d({ id: "w1", stage: "won", valueCents: 500_00, updatedAt: thisMonth }),
      d({ id: "w2", stage: "won", valueCents: 200_00, updatedAt: lastMonth }),
    ];
    const k = computeKpis(deals);
    expect(k.wonThisMonth).toBe(500_00);
    expect(k.wonDealsThisMonth).toBe(1);
    expect(k.activeDeals).toBe(0);
  });
});

describe("PipelinePage", () => {
  function renderPage() {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><PipelinePage /></MemoryRouter>
      </QueryClientProvider>,
    );
  }
  it("renders a computed header subhead with active deals + weighted", () => {
    renderPage();
    // The subhead is the single element matching the full "N active deals ·
    // … weighted" sentence; the KPI tiles render "Active deals"/"Weighted"
    // as separate eyebrow nodes, so scope to the combined-sentence node.
    expect(screen.getByText(/active deals · .* weighted/i)).toBeInTheDocument();
  });
  it("renders the four KPI tiles", () => {
    renderPage();
    expect(screen.getByText(/total pipeline/i)).toBeInTheDocument();
    // "Active deals" appears in both the subhead and a KPI eyebrow.
    expect(screen.getAllByText(/active deals/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/won this month/i)).toBeInTheDocument();
  });
  it("renders deal cards for the loaded deals", () => {
    renderPage();
    // Kanban default renders the card in both the lg+ board and the
    // below-lg fallback grid (CSS hides one; jsdom keeps both), so the
    // company name appears more than once.
    expect(screen.getAllByText(MOCK_DEALS[0].companyName).length).toBeGreaterThan(0);
  });

  it("renders the Filter trigger and the Sort control", () => {
    renderPage();
    expect(screen.getByRole("button", { name: /filter/i })).toBeInTheDocument();
    // Sort Select renders its current value as the trigger label.
    expect(screen.getByText(/sort: last activity/i)).toBeInTheDocument();
  });

  it("applying the min-probability filter drops low-probability deals from the rendered cards", () => {
    // Three open-stage deals with differing probabilities. The two
    // higher ones should survive a 50%+ filter; the 20% one shouldn't.
    mockDeals = [
      d({ id: "lo", companyName: "Lowball LLC", stage: "new", probability: 20 }),
      d({ id: "mid", companyName: "Midtier Inc", stage: "qualified", probability: 60 }),
      d({ id: "hi", companyName: "Highrise Co", stage: "proposal", probability: 90 }),
    ];
    renderPage();

    // Sanity: all three render before filtering.
    expect(screen.getAllByText("Lowball LLC").length).toBeGreaterThan(0);

    // Open the Filter popover, then pick "50%+" in the Min probability Select.
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    // The popover has one Radix Select (Min probability) whose trigger shows
    // the placeholder "Any"; the page's other combobox is the Sort control
    // (reads "Sort: …"), so the "Any"-labelled combobox is unambiguous.
    const probTrigger = screen
      .getAllByRole("combobox")
      .find((el) => el.textContent?.trim() === "Any");
    expect(probTrigger).toBeDefined();
    fireEvent.click(probTrigger!);
    fireEvent.click(screen.getByText("50%+"));

    // The 20% deal is filtered out of the rendered cards; the others stay.
    expect(screen.queryByText("Lowball LLC")).toBeNull();
    expect(screen.getAllByText("Midtier Inc").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Highrise Co").length).toBeGreaterThan(0);
  });
});
