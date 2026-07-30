import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  PipelineByStage,
  ConversionFunnel,
  MonthlyPerformance,
  LeadSources,
  TodaysSnapshot,
  TopPartners,
} from "./DashboardPage";
import type { DashboardData } from "../hooks/useDashboardData";
import type { Partner } from "@/features/partners/mockData";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});
vi.mock("@/features/profession/useTerm", () => ({ useTerm: (k: string) => k }));
// LS-3: the LeadSources widget reads its own data (useDeals + activities) and
// runs the report engine, rather than taking a prop. Two rep-sourced Path
// leads created inside the window put it in the warming state (< 30 won).
vi.mock("@/features/pipeline/hooks/useDeals", () => {
  const created = new Date();
  created.setDate(created.getDate() - 20);
  const iso = created.toISOString();
  const deals = [
    { id: "d1", leadSource: "path", stage: "won", valueCents: 120000, createdAt: iso, closedWonAt: iso, timeToWinCalendarDays: 15, owner_id: "u1" },
    { id: "d2", leadSource: "path", stage: "qualified", valueCents: 80000, createdAt: iso, closedWonAt: null, timeToWinCalendarDays: null, owner_id: "u1" },
  ];
  return { useDeals: () => ({ data: deals }) };
});
vi.mock("@/features/activities/hooks/useActivities", () => ({ useActivitiesForOrg: () => ({ data: [] }) }));

beforeEach(() => { navigateMock.mockReset(); });

describe("PipelineByStage drill-down", () => {
  const byStage: DashboardData["byStage"] = [
    { stage: "proposal", label: "Proposal", count: 3, valueCents: 900000, percentOfPipeline: 40 },
  ];
  it("clicking a stage row navigates to the pre-filtered pipeline", () => {
    render(<PipelineByStage byStage={byStage} />);
    fireEvent.click(screen.getByRole("button", { name: /proposal/i }));
    expect(navigateMock).toHaveBeenCalledWith("/pipeline?stage=proposal");
  });
});

describe("ConversionFunnel drill-down", () => {
  const funnel: DashboardData["conversionFunnel"] = [
    { from: "qualified", to: "proposal", fromLabel: "Qualified", toLabel: "Proposal", fromCount: 10, toCount: 6, rate: 60 },
  ];
  it("clicking a funnel step navigates to the destination stage", () => {
    render(<ConversionFunnel funnel={funnel} />);
    fireEvent.click(screen.getByRole("button", { name: /qualified.*proposal/i }));
    expect(navigateMock).toHaveBeenCalledWith("/pipeline?stage=proposal");
  });
});

describe("MonthlyPerformance drill-down", () => {
  const months: DashboardData["monthlyPerformance"] = [
    { monthLabel: "Jul", monthKey: "2026-07", deals: 2, valueCents: 500000 },
  ];
  it("clicking a month navigates to the won-deals list", () => {
    render(<MonthlyPerformance months={months} />);
    fireEvent.click(screen.getByRole("button", { name: /Jul/ }));
    expect(navigateMock).toHaveBeenCalledWith("/pipeline?stage=won");
  });

  it("the 'View won' header action navigates to the won-deals list", () => {
    render(<MonthlyPerformance months={months} />);
    fireEvent.click(screen.getByRole("button", { name: /view won/i }));
    expect(navigateMock).toHaveBeenCalledWith("/pipeline?stage=won");
  });
});

describe("LeadSources widget (LS-3)", () => {
  it("the whole card opens the lead source report", () => {
    render(<LeadSources />);
    fireEvent.click(screen.getByRole("button", { name: /source/i }));
    expect(navigateMock).toHaveBeenCalledWith("/dashboard/lead-source");
  });
});

// ActivitiesToWinHero has its own test file (ActivitiesToWinHero.test.tsx) now
// that it reads useActivityToWin + useProfile directly.

describe("TodaysSnapshot drill-down (regression — already wired)", () => {
  const snapshot: DashboardData["todaysSnapshot"] = { tasksDueToday: 3, partnersOverdue: 2 };
  it("tasks row → /activities, overdue row → /partners", () => {
    render(<TodaysSnapshot snapshot={snapshot} />);
    fireEvent.click(screen.getByText(/tasks due today/i));
    expect(navigateMock).toHaveBeenCalledWith("/activities");
    fireEvent.click(screen.getByText(/partners overdue/i));
    expect(navigateMock).toHaveBeenCalledWith("/partners");
  });
});

describe("TopPartners drill-down (regression — already wired)", () => {
  const topPartners: DashboardData["topPartners"] = [
    { rank: 1, partner: { id: "p1", name: "Auris" } as unknown as Partner, referrals: 5, revenueCents: 120000 },
  ];
  it("clicking a partner row → /partners/:id", () => {
    render(<TopPartners topPartners={topPartners} />);
    fireEvent.click(screen.getByText("Auris"));
    expect(navigateMock).toHaveBeenCalledWith("/partners/p1");
  });
});
