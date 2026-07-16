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
vi.mock("../hooks/useOrgMemberNames", () => ({
  useOrgMemberNames: () => new Map([["u1", "Sarah Lim"], ["u2", "Marcus Tan"]]),
}));

let agg: ActivityToWinAggregate;
vi.mock("../hooks/useActivityToWin", () => ({ useActivityToWin: () => agg }));

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
      row({ dealId: "d1", companyName: "Northside Diner", ownerId: "u1", source: "Cold", closedWonAt: "2026-07-02T00:00:00.000Z", counts: { total: 5, call: 2, email: 1, dropin: 2, appointment: 0 }, businessDays: 8 }),
      row({ dealId: "d2", companyName: "Beacon Auto", ownerId: "u2", source: "Referral", closedWonAt: "2026-06-28T00:00:00.000Z", counts: { total: 6, call: 3, email: 2, dropin: 0, appointment: 1 }, businessDays: 11 }),
      row({ dealId: "d3", companyName: "Vista Payments", ownerId: "u2", source: "Cold", closedWonAt: "2026-06-20T00:00:00.000Z", counts: { total: 31, call: 18, email: 9, dropin: 4, appointment: 0 }, businessDays: 67, isOutlier: true }),
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
beforeEach(() => { navigateMock.mockReset(); role = "manager"; agg = populated(); });

describe("ActivityToWinReport", () => {
  it("shows the summary medians and sample size", () => {
    renderReport();
    expect(screen.getByText("median touches to close")).toBeInTheDocument();
    expect(screen.getByText("median business days to close")).toBeInTheDocument();
    expect(screen.getByText(/3 won deals/)).toBeInTheDocument();
  });

  it("lists deals sorted by close date descending", () => {
    renderReport();
    const bodyRows = screen.getAllByRole("row").slice(1); // drop header row
    const names = bodyRows.map((r) => within(r).getAllByRole("cell")[0]!.textContent);
    expect(names[0]).toContain("Northside Diner"); // Jul 2
    expect(names[1]).toContain("Beacon Auto"); // Jun 28
    expect(names[2]).toContain("Vista Payments"); // Jun 20
  });

  it("flags outlier rows", () => {
    renderReport();
    const vista = screen.getByText("Vista Payments").closest("tr")!;
    expect(within(vista).getByText("outlier")).toBeInTheDocument();
  });

  it("shows the Rep column for managers, hides it for reps", () => {
    const { unmount } = renderReport();
    expect(screen.getByText("Sarah Lim")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /rep/i })).toBeInTheDocument();
    unmount();

    role = "rep";
    renderReport();
    expect(screen.queryByRole("columnheader", { name: /rep/i })).toBeNull();
  });

  it("clicking a row opens the deal", () => {
    renderReport();
    fireEvent.click(screen.getByText("Beacon Auto").closest("tr")!);
    expect(navigateMock).toHaveBeenCalledWith("/pipeline/d2");
  });

  it("renders an empty state when there are no won deals", () => {
    agg = { ...populated(), rows: [], sampleSize: 0, insufficientData: true };
    renderReport();
    expect(screen.getByText(/No won deals in this window/)).toBeInTheDocument();
  });

  it("renders the window, source, and value-band filter controls", () => {
    renderReport();
    expect(screen.getAllByRole("combobox")).toHaveLength(3);
  });

  it("surfaces unmeasured wins and the low-sample caveat", () => {
    agg = { ...populated(), sampleSize: 2, unmeasuredWins: 4, insufficientData: true };
    renderReport();
    expect(screen.getByText(/2 won deals · 4 unmeasured/)).toBeInTheDocument();
    expect(screen.getByText(/Fewer than 3 deals/)).toBeInTheDocument();
  });
});
