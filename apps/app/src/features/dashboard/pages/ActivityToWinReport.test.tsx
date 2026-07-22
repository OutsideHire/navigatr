import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ActivityToWinReport } from "./ActivityToWinReport";
import type { ActivityToWinAggregate } from "../lib/activityToWin";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

let role: "rep" | "manager" | "admin" | undefined = "manager";
vi.mock("@/features/auth/useProfile", () => ({ useProfile: () => ({ data: { role } }) }));

let orgBands: { valueBandLowCents: number | null; valueBandHighCents: number | null };
vi.mock("@/features/auth/useOrganization", () => ({
  useOrganization: () => ({ data: orgBands }),
}));
vi.mock("../hooks/useOrgMemberNames", () => ({
  useOrgMemberNames: () => new Map([["u1", "Sarah Lim"], ["u2", "Marcus Tan"]]),
}));

let agg: ActivityToWinAggregate;
let lostSummary: {
  sampleSize: number;
  insufficientData: boolean;
  medianTotal: number | null;
  medianBusinessDays: number | null;
};
let lostFilters: unknown;
vi.mock("../hooks/useActivityToWin", () => ({
  useActivityToWin: () => agg,
  useActivityToLost: (_range: unknown, filters: unknown) => {
    lostFilters = filters;
    return lostSummary;
  },
}));

function row(o: Partial<ActivityToWinAggregate["rows"][number]> & { dealId: string; companyName: string }) {
  return {
    ownerId: "u1", source: "Cold", valueCents: 5_000_000,
    closedWonAt: "2026-06-01T00:00:00.000Z", firstActivityAt: "2026-05-20T00:00:00.000Z",
    counts: { total: 5, call: 2, email: 1, dropin: 2, appointment: 0 },
    businessDays: 8, calendarDays: 11, isOutlier: false,
    ...o,
  };
}

function populated(): ActivityToWinAggregate {
  return {
    sampleSize: 3, insufficientData: false, unmeasuredWins: 0,
    medianTotal: 6, meanTotal: 6, medianByType: { call: 3, email: 2, dropin: 2, appointment: 0 },
    timingSampleSize: 3, medianBusinessDays: 11, medianCalendarDays: 15,
    p25BusinessDays: 8, p75BusinessDays: 30,
    rows: [
      row({ dealId: "d1", companyName: "Northside Diner", ownerId: "u1", source: "Cold", valueCents: 8_000_000, closedWonAt: "2026-07-02T00:00:00.000Z", counts: { total: 5, call: 2, email: 1, dropin: 2, appointment: 0 }, businessDays: 8 }),
      row({ dealId: "d2", companyName: "Beacon Auto", ownerId: "u2", source: "Referral", valueCents: 25_000_000, closedWonAt: "2026-06-28T00:00:00.000Z", counts: { total: 6, call: 3, email: 2, dropin: 0, appointment: 1 }, businessDays: 11 }),
      row({ dealId: "d3", companyName: "Vista Payments", ownerId: "u2", source: "Cold", valueCents: 4_000_000, closedWonAt: "2026-06-20T00:00:00.000Z", counts: { total: 31, call: 18, email: 9, dropin: 4, appointment: 0 }, businessDays: 67, isOutlier: true }),
    ],
  };
}

function renderReport() {
  return render(<MemoryRouter initialEntries={["/dashboard/activity-to-win"]}><ActivityToWinReport /></MemoryRouter>);
}

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  }
});
beforeEach(() => {
  navigateMock.mockReset();
  role = "manager";
  agg = populated();
  lostSummary = { sampleSize: 5, insufficientData: false, medianTotal: 3, medianBusinessDays: 22 };
  orgBands = { valueBandLowCents: null, valueBandHighCents: null };
  lostFilters = undefined;
});

describe("ActivityToWinReport (Activities Report)", () => {
  it("renders the gradient header with title and subtitle", () => {
    renderReport();
    expect(screen.getByRole("heading", { name: "Activities Report" })).toBeInTheDocument();
    expect(screen.getByText(/Closed Won Deals/i)).toBeInTheDocument();
  });

  it("shows the four KPI cards with averaged values", () => {
    renderReport();
    expect(screen.getByText("Total Deals Closed")).toBeInTheDocument();
    expect(screen.getByText("Avg Activities / Deal")).toBeInTheDocument();
    expect(screen.getByText("Most Efficient")).toBeInTheDocument();
    expect(screen.getByText("Highest Value")).toBeInTheDocument();
    // Highest-value deal (Beacon Auto, $250K) surfaces as the KPI value (and in the table).
    expect(screen.getAllByText("Beacon Auto").length).toBeGreaterThan(0);
  });

  it("shows the salesperson performance ranking, revenue-sorted", () => {
    renderReport();
    const section = screen.getByRole("region", { name: /salesperson performance/i });
    const names = within(section).getAllByTestId("rep-name").map((n) => n.textContent);
    expect(names[0]).toContain("Marcus Tan");
    expect(names[1]).toContain("Sarah Lim");
  });

  it("shows average activities by type, labelling drop-ins as Visits", () => {
    renderReport();
    const section = screen.getByRole("region", { name: /average activities by type/i });
    expect(within(section).getByText(/Visits/i)).toBeInTheDocument();
    expect(within(section).getByText(/Calls/i)).toBeInTheDocument();
  });

  it("sorts the deal table by a column when its header is clicked", () => {
    renderReport();
    const table = screen.getByRole("table");
    let names = within(table).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0]!.textContent);
    expect(names[0]).toContain("Beacon Auto");
    fireEvent.click(within(table).getByRole("button", { name: /^Total/i }));
    names = within(table).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0]!.textContent);
    expect(names[0]).toContain("Vista Payments");
  });

  it("renders the Rep column for managers, hides it for reps", () => {
    const { unmount } = renderReport();
    expect(screen.getByRole("columnheader", { name: /rep/i })).toBeInTheDocument();
    unmount();
    role = "rep";
    renderReport();
    expect(screen.queryByRole("columnheader", { name: /rep/i })).toBeNull();
  });

  it("clicking a deal row opens the deal", () => {
    renderReport();
    const table = screen.getByRole("table");
    fireEvent.click(within(table).getByText("Beacon Auto").closest("tr")!);
    expect(navigateMock).toHaveBeenCalledWith("/pipeline/d2");
  });

  it("renders the key insights panel", () => {
    renderReport();
    const section = screen.getByRole("region", { name: /key insights/i });
    expect(within(section).getAllByRole("listitem").length).toBeGreaterThan(0);
  });

  it("filters every section to a chosen salesperson", () => {
    renderReport();
    const salesperson = screen.getAllByRole("combobox")[0]!;
    fireEvent.click(salesperson);
    fireEvent.click(screen.getByRole("option", { name: /Marcus Tan/i }));
    const table = screen.getByRole("table");
    const bodyRows = within(table).getAllByRole("row").slice(1);
    expect(bodyRows).toHaveLength(2);
    expect(screen.queryByText("Northside Diner")).toBeNull();
  });

  it("renders an empty state when there are no won deals", () => {
    agg = { ...populated(), rows: [], sampleSize: 0, insufficientData: true };
    renderReport();
    expect(screen.getByText(/No won deals in this window/i)).toBeInTheDocument();
  });

  it("keeps the secondary extras: window/source/band filters and Compare-to-Lost", () => {
    renderReport();
    fireEvent.click(screen.getByRole("checkbox", { name: /compare to lost/i }));
    expect(screen.getByText(/Compared to lost/i)).toBeInTheDocument();
    expect(screen.getByText(/5 lost deals/i)).toBeInTheDocument();
  });

  it("shows the month trend when the window spans 2+ months", () => {
    renderReport();
    expect(screen.getByText(/Trend by close month/i)).toBeInTheDocument();
  });

  it("exports the visible rows to CSV on click", () => {
    const createObjectURL = vi.fn(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
    let downloadName = "";
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloadName = this.download;
      });

    renderReport();
    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(downloadName).toMatch(/^activities-report-\d{4}-\d{2}-\d{2}\.csv$/);

    clickSpy.mockRestore();
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
  });

  it("disables export when there are no rows", () => {
    agg = { ...populated(), rows: [], sampleSize: 0, insufficientData: true };
    renderReport();
    expect(screen.getByRole("button", { name: /export csv/i })).toBeDisabled();
  });

  it("scopes Compare-to-Lost to the chosen salesperson", () => {
    renderReport();
    const salesperson = screen.getAllByRole("combobox")[0]!;
    fireEvent.click(salesperson);
    fireEvent.click(screen.getByRole("option", { name: /Marcus Tan/i }));
    expect(lostFilters).toMatchObject({ ownerId: "u2" });
  });
});
