import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActivitiesToWinHero } from "./DashboardPage";
import type { ActivityToWinAggregate } from "../lib/activityToWin";
import { resolveRange } from "../lib/dateRange";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

let role: "rep" | "manager" | "admin" | undefined = "manager";
vi.mock("@/features/auth/useProfile", () => ({ useProfile: () => ({ data: { role } }) }));

let agg: ActivityToWinAggregate;
vi.mock("../hooks/useActivityToWin", () => ({ useActivityToWin: () => agg }));

const RANGE = resolveRange("90d", new Date("2026-07-16T00:00:00.000Z"));

function populated(over: Partial<ActivityToWinAggregate> = {}): ActivityToWinAggregate {
  return {
    sampleSize: 14,
    insufficientData: false,
    unmeasuredWins: 0,
    medianTotal: 6,
    meanTotal: 6.4,
    medianByType: { call: 3, email: 2, dropin: 4, appointment: 1 },
    timingSampleSize: 14,
    medianBusinessDays: 12,
    medianCalendarDays: 17,
    p25BusinessDays: 9,
    p75BusinessDays: 20,
    rows: [
      { dealId: "a", companyName: "A", ownerId: "u1", source: "Cold", valueCents: 0, closedWonAt: "2026-06-01T00:00:00Z", firstActivityAt: null, counts: { total: 4, call: 2, email: 1, dropin: 1, appointment: 0 }, businessDays: 6, calendarDays: 8, isOutlier: false },
      { dealId: "b", companyName: "B", ownerId: "u2", source: "Cold", valueCents: 0, closedWonAt: "2026-06-02T00:00:00Z", firstActivityAt: null, counts: { total: 11, call: 6, email: 3, dropin: 2, appointment: 0 }, businessDays: 30, calendarDays: 40, isOutlier: false },
    ],
    ...over,
  };
}

beforeEach(() => {
  navigateMock.mockReset();
  role = "manager";
});

describe("ActivitiesToWinHero", () => {
  it("renders both medians, per-type pills, sample size, and the scope/window chip", () => {
    agg = populated();
    render(<ActivitiesToWinHero range={RANGE} windowLabel="Last 90 days" />);
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("median touches to close")).toBeInTheDocument();
    expect(screen.getByText("median business days to close")).toBeInTheDocument();
    expect(screen.getByText("3 calls")).toBeInTheDocument();
    expect(screen.getByText("1 appointment")).toBeInTheDocument();
    expect(screen.getByText(/Your team · Last 90 days/)).toBeInTheDocument();
    expect(screen.getByText(/Based on 14 won deals/)).toBeInTheDocument();
  });

  it("manager sees a rep comparison band; rep does not", () => {
    agg = populated();
    const { unmount } = render(<ActivitiesToWinHero range={RANGE} windowLabel="Last 90 days" />);
    // Two reps with medians 4 and 11 touches, 6 and 30 days.
    expect(screen.getByText(/reps range 4-11 touches · 6-30 days/)).toBeInTheDocument();
    unmount();

    role = "rep";
    render(<ActivitiesToWinHero range={RANGE} windowLabel="Last 90 days" />);
    expect(screen.queryByText(/reps range/)).toBeNull();
  });

  it("shows the insufficient-data state with progress below the minimum", () => {
    agg = populated({ insufficientData: true, sampleSize: 2 });
    render(<ActivitiesToWinHero range={RANGE} windowLabel="Last 90 days" />);
    expect(screen.getByText("Not enough data yet")).toBeInTheDocument();
    expect(screen.getByText("2 of 3 won deals so far")).toBeInTheDocument();
  });

  it("surfaces unmeasured wins when present", () => {
    agg = populated({ unmeasuredWins: 3 });
    render(<ActivitiesToWinHero range={RANGE} windowLabel="Last 90 days" />);
    expect(screen.getByText(/3 unmeasured/)).toBeInTheDocument();
  });

  it("clicking the hero navigates to the activity list", () => {
    agg = populated();
    render(<ActivitiesToWinHero range={RANGE} windowLabel="Last 90 days" />);
    fireEvent.click(screen.getByRole("button", { name: /activity-to-win/i }));
    expect(navigateMock).toHaveBeenCalledWith("/activities");
  });
});
