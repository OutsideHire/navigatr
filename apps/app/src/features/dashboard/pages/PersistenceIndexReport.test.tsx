import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PersistenceIndexReport, busyDayThreshold } from "./PersistenceIndexReport";
import type { PersistencePoint, PerRepScore } from "../lib/persistenceIndex";
import type { DirectReportInput } from "../lib/directReports";

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

// Logging Coverage gate: default empty rows so existing tests are ungated.
let coverageRows: { userId: string; compositeCoverage: number | null }[] = [];
vi.mock("@/features/coverage/hooks/useCoverageRollup", () => ({
  useCoverageRollup: () => ({ rows: coverageRows, isLoading: false }),
}));

// Direct-reports table data + all-reps overlay (SP-1). Mocked so the page test
// stays free of a QueryClient, like the other data hooks.
let directReportsData: DirectReportInput[] = [];
vi.mock("../hooks/useDirectReports", () => ({ useDirectReports: () => directReportsData }));
let allRepsHistory: { ownerId: string; values: (number | null)[] }[] = [];
vi.mock("../hooks/useAllRepsHistory", () => ({
  // Mirror the real hook: returns [] unless the "All reps" toggle enabled it.
  useAllRepsHistory: (_range: number, enabled: boolean) => (enabled ? allRepsHistory : []),
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
  coverageRows = [];
  directReportsData = [
    { ownerId: "u1", name: "Sarah Lim", role: "Sales Professional", composite: 82, delta30: 3, activityCount: 120, spark: [78, 80, 82] },
    { ownerId: "u2", name: "Marcus Tan", role: "Sales Professional", composite: 60, delta30: -4, activityCount: 90, spark: [66, 63, 60] },
  ];
  allRepsHistory = [];
});

describe("busyDayThreshold", () => {
  it("averages only the days that had activity", () => {
    expect(busyDayThreshold([0, 0, 4, 8])).toBe(6); // (4+8)/2, zeros excluded
  });
  it("is 0 when there was no activity", () => {
    expect(busyDayThreshold([0, 0, 0])).toBe(0);
  });
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

  it("zooms the trend chart y-axis to the data range (not a fixed 0-100 scale)", () => {
    // The axis now auto-fits to the plotted values (matching the prototype) so
    // the line fills the chart. With the series clustered high (50-95), a
    // composite of 50 is pushed well below y=90 (where it would sit on a fixed
    // 0-100 scale, H - 50/100*180), confirming the zoom.
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
    expect(Number(firstPoint[2])).toBeGreaterThan(110); // zoomed: 50 sits well below the fixed-scale y=90
  });

  it("renders the sub-component breakdown and stats grid in the per-rep drill-down", () => {
    renderReport();
    // Team view no longer shows the breakdown; it lives in the rep drill-down.
    expect(screen.queryByText(/where your score comes from/i)).toBeNull();
    fireEvent.click(screen.getByText("Sarah Lim"));
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

  it("shows the direct-reports table for a manager", () => {
    role = "manager";
    renderReport();
    expect(screen.getByText("Direct reports")).toBeInTheDocument();
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
    // The rep name now appears in the breadcrumb, rep-switcher, and card subject.
    expect(screen.getAllByText(/Sarah Lim/).length).toBeGreaterThan(0);
    const back = screen.getByRole("button", { name: /back to team/i });
    expect(back).toBeInTheDocument();
    fireEvent.click(back);
    expect(screen.getByText("Direct reports")).toBeInTheDocument(); // team table returns
  });

  it("shows the All reps overlay toggle on the team view but not in the drill-down", () => {
    role = "manager";
    renderReport();
    expect(screen.getByRole("button", { name: /all.*reps/i })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Sarah Lim"));
    expect(screen.queryByRole("button", { name: /all.*reps/i })).toBeNull();
  });

  it("labels the activity-volume bars busier vs lighter days", () => {
    role = "manager";
    renderReport();
    expect(screen.getByText("Busier day")).toBeInTheDocument();
    expect(screen.getByText("Lighter day")).toBeInTheDocument();
  });

  it("overlays each rep's line on the chart when All reps is toggled on", () => {
    role = "manager";
    allRepsHistory = [
      { ownerId: "u1", values: series.map((_, i) => 70 + (i % 5)) },
      { ownerId: "u2", values: series.map((_, i) => 60 + (i % 5)) },
    ];
    renderReport();
    // Off by default: no overlay lines.
    expect(screen.queryAllByTestId("rep-overlay-line")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /all.*reps/i }));
    expect(screen.getAllByTestId("rep-overlay-line").length).toBeGreaterThan(0);
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

  describe("Logging Coverage gate (selected-rep drill-down)", () => {
    it("suppresses the score and hides the breakdown when the selected rep's coverage is below 50%", () => {
      role = "manager";
      coverageRows = [{ userId: "u1", compositeCoverage: 0.4 }];
      renderReport();
      fireEvent.click(screen.getByText("Sarah Lim"));
      expect(screen.getByText(/not enough logging to score yet/i)).toBeInTheDocument();
      expect(screen.queryByText(/where your score comes from/i)).toBeNull();
      expect(screen.queryByText("This period")).toBeNull();
      // Back-to-team + rep header stay so the manager can navigate back.
      expect(screen.getByRole("button", { name: /back to team/i })).toBeInTheDocument();
      expect(screen.getAllByText(/Sarah Lim/).length).toBeGreaterThan(0);
    });

    it("shows a caveat line but still renders the score when coverage is between 50% and 75%", () => {
      role = "manager";
      coverageRows = [{ userId: "u1", compositeCoverage: 0.6 }];
      renderReport();
      fireEvent.click(screen.getByText("Sarah Lim"));
      expect(screen.getByText(/logging coverage is low \(60%\); this score may be incomplete/i)).toBeInTheDocument();
      // Score + trend still render (not suppressed): the sub-component breakdown
      // comes from the un-gated branch.
      expect(screen.getByText(/where your score comes from/i)).toBeInTheDocument();
    });

    it("does not gate when the selected rep has no coverage entry (absent data is not low coverage)", () => {
      role = "manager";
      coverageRows = []; // no entry for u1
      renderReport();
      fireEvent.click(screen.getByText("Sarah Lim"));
      expect(screen.queryByText(/not enough logging to score yet/i)).toBeNull();
      expect(screen.queryByText(/logging coverage is low/i)).toBeNull();
      // Un-gated: the drill-down breakdown renders.
      expect(screen.getByText(/where your score comes from/i)).toBeInTheDocument();
    });

    it("never gates the team-aggregate view, even if the manager's own coverage is low", () => {
      role = "manager";
      coverageRows = [{ userId: "mgr", compositeCoverage: 0.1 }];
      renderReport();
      expect(screen.queryByText(/not enough logging to score yet/i)).toBeNull();
      expect(screen.queryByText(/logging coverage is low/i)).toBeNull();
      // Team content still renders (the reps table), not a suppressed message.
      expect(screen.getByText("Direct reports")).toBeInTheDocument();
    });
  });
});
