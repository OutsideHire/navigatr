import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  PipelineByStage,
  ConversionFunnel,
  MonthlyPerformance,
  LeadSources,
  ActivitiesToWinHero,
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
});

describe("LeadSources drill-down", () => {
  const leadSources: DashboardData["leadSources"] = [
    { label: "Partner referral", count: 4, percent: 80 },
    { label: "Cold outreach", count: 1, percent: 20 },
  ];
  it("clicking a legend row navigates to the source-filtered pipeline (encoded)", () => {
    render(<LeadSources leadSources={leadSources} />);
    fireEvent.click(screen.getByRole("button", { name: /Partner referral/ }));
    expect(navigateMock).toHaveBeenCalledWith("/pipeline?source=Partner%20referral");
  });
});

describe("ActivitiesToWinHero drill-down", () => {
  const data: DashboardData["activitiesToWin"] = { ratio: 4.2, totalActivities: 42, wonDealsCount: 10 };
  it("clicking the hero navigates to activities", () => {
    render(<ActivitiesToWinHero data={data} />);
    fireEvent.click(screen.getByRole("button", { name: /activities per win/i }));
    expect(navigateMock).toHaveBeenCalledWith("/activities");
  });
});

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
