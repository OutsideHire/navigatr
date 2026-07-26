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
  role = "rep";
  series = mkSeries(30);
  roster = [
    { ownerId: "u1", composite: 82, followUpPoints: 34, cadencePoints: 24, reEngagementPoints: 22 },
    { ownerId: "u2", composite: 60, followUpPoints: 20, cadencePoints: 18, reEngagementPoints: 14 },
  ];
  lastTargetOwner = undefined;
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

  it("does not show the roster for a rep", () => {
    role = "rep";
    renderReport();
    expect(screen.queryByText(/by rep/i)).toBeNull();
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
});
