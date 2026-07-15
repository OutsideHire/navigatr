import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { computeKpis, countByStage, buildWonAtMap, parseStageParam, PipelinePage } from "./PipelinePage";
import type { Deal } from "../mockData";
import { MOCK_DEALS } from "../mockData";
import type { StageHistoryRow } from "../hooks/useStageHistory";

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
// Stage history is a network read; the page uses it for won-this-month. Keep
// it empty here so the render tests are deterministic (computeKpis falls back
// to updatedAt). buildWonAtMap/computeKpis are unit-tested directly below.
vi.mock("../hooks/useStageHistory", () => ({
  useStageHistory: () => ({ data: [] }),
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

  it("gates won-this-month on the stage-history win date, not updatedAt", () => {
    // Regression (Bug 3): updated_at bumps on ANY edit, so a deal won months
    // ago but edited this month used to re-count. The stage-history WON date
    // is authoritative.
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 2).toISOString();
    const monthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 10).toISOString();
    const deals = [
      // Won 3 months ago, then EDITED this month (updatedAt bumped).
      d({ id: "old-win", stage: "won", valueCents: 400_00, updatedAt: thisMonth }),
      // Genuinely won this month.
      d({ id: "new-win", stage: "won", valueCents: 600_00, updatedAt: thisMonth }),
    ];
    const wonAt = new Map<string, string>([
      ["old-win", monthsAgo],
      ["new-win", thisMonth],
    ]);
    const k = computeKpis(deals, wonAt);
    expect(k.wonDealsThisMonth).toBe(1);
    expect(k.wonThisMonth).toBe(600_00);
  });

  it("falls back to updatedAt for won deals absent from stage history", () => {
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 2).toISOString();
    const deals = [d({ id: "legacy", stage: "won", valueCents: 300_00, updatedAt: thisMonth })];
    const k = computeKpis(deals, new Map());
    expect(k.wonThisMonth).toBe(300_00);
    expect(k.wonDealsThisMonth).toBe(1);
  });
});

describe("buildWonAtMap", () => {
  const row = (over: Partial<StageHistoryRow>): StageHistoryRow => ({
    id: "h1",
    dealId: "d1",
    fromStage: "proposal",
    toStage: "won",
    transitionedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  });

  it("returns an empty map for undefined history", () => {
    expect(buildWonAtMap(undefined).size).toBe(0);
  });

  it("indexes only WON transitions by dealId", () => {
    const map = buildWonAtMap([
      row({ id: "a", dealId: "d1", toStage: "won", transitionedAt: "2026-03-01T00:00:00.000Z" }),
      row({ id: "b", dealId: "d2", toStage: "proposal", transitionedAt: "2026-03-02T00:00:00.000Z" }),
    ]);
    expect(map.get("d1")).toBe("2026-03-01T00:00:00.000Z");
    expect(map.has("d2")).toBe(false);
  });

  it("keeps the most recent win when a deal was re-won", () => {
    const map = buildWonAtMap([
      row({ id: "a", dealId: "d1", toStage: "won", transitionedAt: "2026-01-01T00:00:00.000Z" }),
      row({ id: "b", dealId: "d1", toStage: "won", transitionedAt: "2026-05-01T00:00:00.000Z" }),
    ]);
    expect(map.get("d1")).toBe("2026-05-01T00:00:00.000Z");
  });
});

describe("countByStage", () => {
  it("returns all-zero counts for no deals (fresh org shows no fabricated totals)", () => {
    expect(countByStage([])).toEqual({
      all: 0, new: 0, contacted: 0, qualified: 0, proposal: 0, won: 0, lost: 0,
    });
    expect(countByStage(undefined)).toEqual({
      all: 0, new: 0, contacted: 0, qualified: 0, proposal: 0, won: 0, lost: 0,
    });
  });

  it("counts deals per stage; all = total of the counted set", () => {
    const deals = [
      d({ id: "1", stage: "new" }),
      d({ id: "2", stage: "new" }),
      d({ id: "3", stage: "qualified" }),
      d({ id: "4", stage: "won" }),
      d({ id: "5", stage: "lost" }),
    ];
    const c = countByStage(deals);
    expect(c.new).toBe(2);
    expect(c.qualified).toBe(1);
    expect(c.contacted).toBe(0);
    expect(c.won).toBe(1);
    expect(c.lost).toBe(1);
    expect(c.all).toBe(5); // includes won + lost
  });

  it("scopes counts to the owner filter, matching the KPI strip", () => {
    const deals = [
      d({ id: "1", stage: "new", owner_id: "u-1" }),
      d({ id: "2", stage: "qualified", owner_id: "u-1" }),
      d({ id: "3", stage: "new", owner_id: "u-2" }),
    ];
    const c = countByStage(deals, "u-1");
    expect(c.all).toBe(2);
    expect(c.new).toBe(1);
    expect(c.qualified).toBe(1);
  });
});

describe("parseStageParam", () => {
  it("accepts the real chip stages", () => {
    expect(parseStageParam("proposal")).toBe("proposal");
    expect(parseStageParam("won")).toBe("won");
    expect(parseStageParam("all")).toBe("all");
  });
  it("falls back to 'all' for unknown or missing values", () => {
    expect(parseStageParam("lost")).toBe("all"); // not a chip stage
    expect(parseStageParam("bogus")).toBe("all");
    expect(parseStageParam(null)).toBe("all");
  });
});

describe("PipelinePage", () => {
  function renderPage(path = "/pipeline") {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}><PipelinePage /></MemoryRouter>
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
    // Filter + Sort now render in BOTH the desktop action row and the mobile
    // control row (jsdom ignores media queries, so both are in the DOM).
    expect(screen.getAllByRole("button", { name: /filter/i }).length).toBeGreaterThanOrEqual(2);
    // Sort Select renders its current value as the trigger label.
    expect(screen.getAllByText(/sort: last activity/i).length).toBeGreaterThanOrEqual(2);
  });

  it("exposes search, filter, and sort controls on the mobile control row", () => {
    renderPage();
    const mobile = screen.getByTestId("pipeline-mobile-controls");
    // Search input (type=search) reachable inside the mobile row.
    expect(within(mobile).getByPlaceholderText(/search deals/i)).toBeInTheDocument();
    // Filter trigger reachable inside the mobile row.
    expect(within(mobile).getByRole("button", { name: /filter/i })).toBeInTheDocument();
    // Sort control reachable inside the mobile row.
    expect(within(mobile).getByText(/sort: last activity/i)).toBeInTheDocument();
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

    // Open the Filter popover (scope to the mobile row — the desktop action
    // row renders an identical Filter trigger, so the unscoped query is now
    // ambiguous). Either popover shares the same filters state.
    const mobile = screen.getByTestId("pipeline-mobile-controls");
    fireEvent.click(within(mobile).getByRole("button", { name: /filter/i }));
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

  it("?stage=proposal deep-link pre-filters to Proposal deals", () => {
    mockDeals = [
      d({ id: "p", companyName: "Proposal Co", stage: "proposal" }),
      d({ id: "n", companyName: "Newbie LLC", stage: "new" }),
    ];
    renderPage("/pipeline?stage=proposal");
    expect(screen.getAllByText("Proposal Co").length).toBeGreaterThan(0);
    expect(screen.queryByText("Newbie LLC")).toBeNull();
  });

  it("?source=<label> deep-link filters by lead source and shows a clearable banner", () => {
    mockDeals = [
      d({ id: "referral", companyName: "Referral Co", stage: "new", leadSource: "Partner referral" }),
      d({ id: "cold", companyName: "Cold Co", stage: "new", leadSource: "Cold outreach" }),
    ];
    renderPage("/pipeline?source=Partner%20referral");
    expect(screen.getAllByText("Referral Co").length).toBeGreaterThan(0);
    expect(screen.queryByText("Cold Co")).toBeNull();
    expect(screen.getByText(/filtered by lead source/i)).toBeInTheDocument();
  });

  it("?source=Other matches deals with an empty lead source", () => {
    mockDeals = [
      d({ id: "blank", companyName: "Blank Co", stage: "new", leadSource: "" }),
      d({ id: "set", companyName: "Sourced Co", stage: "new", leadSource: "Webinar" }),
    ];
    renderPage("/pipeline?source=Other");
    expect(screen.getAllByText("Blank Co").length).toBeGreaterThan(0);
    expect(screen.queryByText("Sourced Co")).toBeNull();
  });

  it("no stage/source params → unfiltered (regression)", () => {
    mockDeals = [
      d({ id: "p", companyName: "Proposal Co", stage: "proposal" }),
      d({ id: "n", companyName: "Newbie LLC", stage: "new" }),
    ];
    renderPage("/pipeline");
    expect(screen.getAllByText("Proposal Co").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Newbie LLC").length).toBeGreaterThan(0);
  });
});
