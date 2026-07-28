import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PersistenceIndexReport } from "./PersistenceIndexReport";
import type { PersistencePoint, PerRepScore } from "../lib/persistenceIndex";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

let role: "rep" | "manager" | "admin" = "rep";
vi.mock("@/features/auth/useProfile", () => ({ useProfile: () => ({ data: { role } }) }));

let series: PersistencePoint[];
let lastRangeDays = 0;
let lastTargetOwner: string | undefined;
vi.mock("../hooks/usePersistenceHistory", () => ({
  usePersistenceHistory: (rangeDays: number, targetOwnerId?: string) => {
    lastRangeDays = rangeDays;
    lastTargetOwner = targetOwnerId;
    return series;
  },
}));

let roster: PerRepScore[];
vi.mock("../hooks/usePerRepPersistence", () => ({ usePerRepPersistence: () => roster }));
vi.mock("@/features/dashboard/hooks/useOrgMemberNames", () => ({
  useOrgMemberNames: () => new Map([["u1", "Sarah Lim"], ["u2", "Marcus Tan"]]),
}));

// usePersistenceIndex / useTeamPersistenceIndex read live deals + activities
// via react-query; mock them so the page test doesn't need a QueryClient.
let ownIndex: any = {
  composite: 70,
  followUp: { points: 30, max: 40, hasSample: true },
  cadence: { points: 20, max: 30, hasSample: true },
  reEngagement: { points: 21, max: 30, hasSample: true },
  caveats: { followUpBelowFloor: false },
};
vi.mock("../hooks/usePersistenceIndex", () => ({ usePersistenceIndex: () => ownIndex }));

let teamIndex: any = {
  composite: 68,
  followUp: { points: 28, max: 40 },
  cadence: { points: 19, max: 30 },
  reEngagement: { points: 17, max: 30 },
};
vi.mock("../hooks/useTeamPersistenceIndex", () => ({ useTeamPersistenceIndex: () => teamIndex }));

// SP-B daily company-series: default empty so existing tests exercise the
// unchanged SP-A static-benchmark fallback path.
let companySeriesData: { date: string; median: number | null; p90: number | null; repCount: number }[] = [];
vi.mock("../hooks/usePersistenceCompanySeries", () => ({
  usePersistenceCompanySeries: () => ({ data: companySeriesData }),
}));

function mkSeries(n: number, base = 60): PersistencePoint[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-06-${String((i % 28) + 1).padStart(2, "0")}`,
    composite: base + (i % 10),
    activityCount: i % 4,
  }));
}

function renderReport() {
  return render(
    <MemoryRouter initialEntries={["/dashboard/persistence-index"]}>
      <PersistenceIndexReport />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  navigateMock.mockReset();
  // The detail page is manager-only for beta (addendum 4.2), so the default
  // role for the content tests is manager; the rep-guard case is tested below.
  role = "manager";
  series = mkSeries(30);
  roster = [
    { ownerId: "u1", composite: 82, followUpPoints: 34, cadencePoints: 24, reEngagementPoints: 22, followUpBelowFloor: false, reEngagementSilentCount: 4, reEngagementReEngagedCount: 3 },
    { ownerId: "u2", composite: 60, followUpPoints: 20, cadencePoints: 18, reEngagementPoints: 14, followUpBelowFloor: false, reEngagementSilentCount: 2, reEngagementReEngagedCount: 1 },
  ];
  lastTargetOwner = undefined;
  companySeriesData = [];
});

describe("PersistenceIndexReport", () => {
  it("renders the title, a back link, and the range pills", () => {
    renderReport();
    expect(screen.getByRole("heading", { name: /persistence index/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^1M$/ })).toBeInTheDocument();
  });

  it("defaults to the 1M range and switches when a pill is clicked", () => {
    renderReport();
    expect(lastRangeDays).toBe(30);
    fireEvent.click(screen.getByRole("button", { name: /^3M$/ }));
    expect(lastRangeDays).toBe(90);
  });

  it("renders the trend chart as an SVG when there is data", () => {
    const { container } = renderReport();
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("renders the composite trend line in the addendum blue (#2E5FE2), not the old brand-teal token", () => {
    const { container } = renderReport();
    const svg = container.querySelector('svg[aria-label="Persistence index trend"]')!;
    // Line path: no fill, drawn with the literal blue stroke.
    const linePath = svg.querySelector('path[fill="none"][stroke="#2E5FE2"]');
    expect(linePath).toBeTruthy();
    expect(linePath?.getAttribute("class") ?? "").not.toContain("text-brand-primary");
    // Area path: same blue, translucent fill.
    const areaPath = svg.querySelector('path[fill="#2E5FE2"]');
    expect(areaPath).toBeTruthy();
  });

  it("locks the trend chart y-axis to a fixed 0-100 scale regardless of the data's own min/max", () => {
    // A composite of 50 is the exact vertical midpoint of the 180-tall
    // viewBox under a fixed 0-100 scale (y = H - (v/100)*H = 90), whether the
    // rest of the series clusters near the top or the bottom. If the axis
    // ever started auto-fitting to data min/max instead, this same value
    // would land at a different height depending on the other points.
    role = "manager";
    series = [
      { date: "2026-06-01", composite: 50, activityCount: 1 },
      { date: "2026-06-02", composite: 90, activityCount: 1 },
      { date: "2026-06-03", composite: 95, activityCount: 1 },
    ];
    const { container } = renderReport();
    const svg = container.querySelector('svg[aria-label="Persistence index trend"]')!;
    const linePath = svg.querySelector('path[fill="none"][stroke="#2E5FE2"]');
    const d = linePath!.getAttribute("d")!;
    const firstPoint = d.match(/M([\d.]+),([\d.]+)/)!;
    expect(Number(firstPoint[2])).toBeCloseTo(90, 1); // H(180) - (50/100)*180 = 90
  });

  it("renders the sub-component breakdown and stats grid for a populated view", () => {
    renderReport();
    expect(screen.getByText(/where your score comes from/i)).toBeInTheDocument();
    expect(screen.getByText("This period")).toBeInTheDocument();
  });

  it("shows the empty state when every point is null", () => {
    series = mkSeries(30).map((p) => ({ ...p, composite: null }));
    renderReport();
    expect(screen.getByText(/not enough data/i)).toBeInTheDocument();
  });

  it("back link navigates to the dashboard", () => {
    renderReport();
    fireEvent.click(screen.getByRole("button", { name: /dashboard/i }));
    expect(navigateMock).toHaveBeenCalledWith("/dashboard");
  });

  it("shows the By-rep roster for a manager", () => {
    role = "manager";
    renderReport();
    expect(screen.getByText(/by rep/i)).toBeInTheDocument();
    expect(screen.getByText("Sarah Lim")).toBeInTheDocument();
    expect(screen.getByText("Marcus Tan")).toBeInTheDocument();
  });

  it("shows a managers-only message for a rep and hides the report content", () => {
    role = "rep";
    renderReport();
    expect(screen.getByText(/available to managers during the beta/i)).toBeInTheDocument();
    // None of the report surfaces render for a rep.
    expect(screen.queryByText(/by rep/i)).toBeNull();
    expect(screen.queryByText(/where your score comes from/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /^1M$/ })).toBeNull();
  });

  it("shows the below-floor footnote when the SELECTED rep is below floor", () => {
    role = "manager";
    roster = [
      { ownerId: "u1", composite: 82, followUpPoints: null, cadencePoints: 24, reEngagementPoints: 22, followUpBelowFloor: true, reEngagementSilentCount: 4, reEngagementReEngagedCount: 3 },
      { ownerId: "u2", composite: 60, followUpPoints: 20, cadencePoints: 18, reEngagementPoints: 14, followUpBelowFloor: false, reEngagementSilentCount: 2, reEngagementReEngagedCount: 1 },
    ];
    renderReport();
    fireEvent.click(screen.getByText("Sarah Lim"));
    expect(screen.getByText(/follow-up volume too low/i)).toBeInTheDocument();
  });

  it("does not leak the manager's own below-floor state onto the team view", () => {
    role = "manager";
    // The manager's own follow-up state is below floor, but the displayed
    // data is the team aggregate, not the manager's own score, so the
    // footnote must not appear.
    ownIndex = { ...ownIndex, caveats: { followUpBelowFloor: true } };
    renderReport();
    expect(screen.queryByText(/follow-up volume too low/i)).toBeNull();
  });

  it("clicking a rep drills into their trend and shows Back to team", () => {
    role = "manager";
    renderReport();
    fireEvent.click(screen.getByText("Sarah Lim"));
    expect(lastTargetOwner).toBe("u1");
    expect(screen.getByText(/Sarah Lim/)).toBeInTheDocument();
    const back = screen.getByRole("button", { name: /back to team/i });
    expect(back).toBeInTheDocument();
    fireEvent.click(back);
    expect(screen.getByText(/by rep/i)).toBeInTheDocument(); // roster returns
  });

  it("uses the daily company-average + top-decile lines once the snapshot series has accrued", () => {
    role = "manager";
    // Dates align with the default mkSeries fixture ("2026-06-01", "2026-06-02", ...).
    companySeriesData = [
      { date: "2026-06-01", median: 55, p90: 92, repCount: 4 },
      { date: "2026-06-02", median: 58, p90: 94, repCount: 4 },
    ];
    renderReport();
    expect(screen.getByText(/company average/i)).toBeInTheDocument();
    expect(screen.getByText(/top decile/i)).toBeInTheDocument();
  });

  it("falls back to the existing static SP-A benchmark when fewer than 2 dated points exist", () => {
    role = "manager";
    companySeriesData = [{ date: "2026-06-01", median: 55, p90: 92, repCount: 4 }]; // only 1 point
    renderReport();
    expect(screen.getByText(/team average/i)).toBeInTheDocument();
    expect(screen.queryByText(/company average/i)).toBeNull();
    expect(screen.queryByText(/top decile/i)).toBeNull();
  });

  it("shows the partial /60 score (not /100) with the caveat when a selected rep is below floor", () => {
    role = "manager";
    roster = [
      { ownerId: "u1", composite: null, followUpPoints: null, cadencePoints: 20, reEngagementPoints: 21, followUpBelowFloor: true, reEngagementSilentCount: 5, reEngagementReEngagedCount: 3 },
      { ownerId: "u2", composite: 60, followUpPoints: 20, cadencePoints: 18, reEngagementPoints: 14, followUpBelowFloor: false, reEngagementSilentCount: 2, reEngagementReEngagedCount: 1 },
    ];
    renderReport();
    fireEvent.click(screen.getByText("Sarah Lim")); // drill into the below-floor rep
    expect(screen.getByText("41")).toBeInTheDocument(); // 20 cadence + 21 re-engagement
    expect(screen.getByText(/\/ 60 · cadence \+ re-engagement only/)).toBeInTheDocument();
    expect(screen.queryByText(/\/ 100/)).not.toBeInTheDocument();
    expect(screen.getByText(/follow-up volume too low/i)).toBeInTheDocument();
  });

  it("shows the eligible/recovered counts near the re-engagement row for a selected rep", () => {
    role = "manager";
    roster = [
      { ownerId: "u1", composite: 82, followUpPoints: 34, cadencePoints: 24, reEngagementPoints: 22, followUpBelowFloor: false, reEngagementSilentCount: 5, reEngagementReEngagedCount: 3 },
      { ownerId: "u2", composite: 60, followUpPoints: 20, cadencePoints: 18, reEngagementPoints: 14, followUpBelowFloor: false, reEngagementSilentCount: 2, reEngagementReEngagedCount: 1 },
    ];
    renderReport();
    fireEvent.click(screen.getByText("Sarah Lim"));
    expect(screen.getByText("5 went quiet, 3 brought back")).toBeInTheDocument();
  });

  it("breaks the trend line into multiple path segments on a null-composite gap in the middle of the series", () => {
    role = "manager";
    const withGap = mkSeries(30).map((p, i) => (i === 15 ? { ...p, composite: null } : p));
    series = withGap;
    const { container: withGapContainer } = renderReport();
    const gappedPaths = withGapContainer.querySelectorAll("svg path");

    series = mkSeries(30); // no gap
    const { container: noGapContainer } = renderReport();
    const contiguousPaths = noGapContainer.querySelectorAll("svg path");

    // One internal null splits the single line+area pair into two, so the
    // gapped chart renders twice as many path segments as the contiguous one.
    expect(gappedPaths.length).toBeGreaterThan(contiguousPaths.length);
  });

  it("drops snapshot dates outside the chart range without throwing", () => {
    role = "manager";
    // Two in-range dates plus one that is not in the history series: the
    // out-of-range point must be silently dropped (the date-to-index miss
    // branch), not throw or mis-plot, and the daily lines still render.
    companySeriesData = [
      { date: "2026-06-01", median: 55, p90: 92, repCount: 4 },
      { date: "2026-06-02", median: 58, p90: 94, repCount: 4 },
      { date: "2099-01-01", median: 60, p90: 95, repCount: 4 }, // not in the history points
    ];
    expect(() => renderReport()).not.toThrow();
    expect(screen.getByText(/company average/i)).toBeInTheDocument();
    expect(screen.getByText(/top decile/i)).toBeInTheDocument();
  });
});
