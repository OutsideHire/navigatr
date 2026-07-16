import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SecondaryKpiRow } from "./DashboardPage";
import type { DashboardData } from "../hooks/useDashboardData";
import type { Deal } from "@/features/pipeline/mockData";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

let role: "rep" | "manager" | "admin" | undefined = "manager";
vi.mock("@/features/auth/useProfile", () => ({ useProfile: () => ({ data: { role } }) }));

function deal(o: Partial<Deal> & { id: string }): Deal {
  return {
    id: o.id, companyName: o.id, contactName: "C", phone: "", email: "",
    valueCents: o.valueCents ?? 0, stage: o.stage ?? "qualified", probability: 50,
    lastActivity: "2026-07-01T00:00:00Z", nextFollowup: null, address: null,
    employeeCountRange: "1-9", leadSource: "", updatedAt: "2026-07-01T00:00:00Z",
    owner_id: o.owner_id ?? null, lostReasonCategory: null, lostReasonNotes: null,
  };
}
const DEALS = [deal({ id: "a", owner_id: "u1", stage: "qualified", valueCents: 30000 })];
vi.mock("@/features/pipeline/hooks/useDeals", () => ({ useDeals: () => ({ data: DEALS }) }));
vi.mock("../hooks/useOrgMemberNames", () => ({ useOrgMemberNames: () => new Map([["u1", "Sarah Lim"]]) }));
// useTerm is used for subtitles — return the key so subtitles render plainly.
vi.mock("@/features/profession/useTerm", () => ({ useTerm: (k: string) => k }));

const KPIS: DashboardData["kpis"] = {
  activeDealsCount: 1, pipelineValueCents: 30000, weightedPipelineCents: 15000,
  wonDealsCount: 0, wonRevenueCents: 0, winRate: 0,
};

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});
beforeEach(() => { navigateMock.mockReset(); role = "manager"; });

describe("SecondaryKpiRow drill-down", () => {
  it("manager: clicking Pipeline Value expands the per-rep breakdown; a row navigates to the rep", () => {
    render(<SecondaryKpiRow kpis={KPIS} />);
    // Panel not shown until clicked.
    expect(screen.queryByText("Sarah Lim")).toBeNull();
    fireEvent.click(screen.getByText("PIPELINE VALUE").closest("[role='button']") as HTMLElement);
    expect(screen.getByText("Sarah Lim")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Sarah Lim/ }));
    expect(navigateMock).toHaveBeenCalledWith("/admin/agents/u1");
  });

  it("manager: clicking the open metric again collapses it", () => {
    render(<SecondaryKpiRow kpis={KPIS} />);
    const card = () => screen.getByText("PIPELINE VALUE").closest("[role='button']") as HTMLElement;
    fireEvent.click(card());
    expect(screen.getByText("Sarah Lim")).toBeInTheDocument();
    fireEvent.click(card());
    expect(screen.queryByText("Sarah Lim")).toBeNull();
  });

  it("rep: clicking a KPI navigates to their own pipeline (no breakdown)", () => {
    role = "rep";
    render(<SecondaryKpiRow kpis={KPIS} />);
    fireEvent.click(screen.getByText("PIPELINE VALUE").closest("[role='button']") as HTMLElement);
    expect(navigateMock).toHaveBeenCalledWith("/pipeline");
    expect(screen.queryByText("Sarah Lim")).toBeNull();
  });

  it("Win Rate is not clickable", () => {
    render(<SecondaryKpiRow kpis={KPIS} />);
    expect(screen.getByText("WIN RATE").closest("[role='button']")).toBeNull();
  });

  it("manager: shows a 'By rep' drill cue on the three drillable cards, not on Win Rate", () => {
    render(<SecondaryKpiRow kpis={KPIS} />);
    // One cue per drillable KPI (Active Leads, Pipeline Value, Won).
    expect(screen.getAllByText("By rep")).toHaveLength(3);
    // Win Rate card carries no cue.
    const winCard = screen.getByText("WIN RATE").closest("div");
    expect(winCard?.textContent).not.toMatch(/By rep|View/);
  });

  it("rep: shows a 'View' drill cue (navigates), not 'By rep'", () => {
    role = "rep";
    render(<SecondaryKpiRow kpis={KPIS} />);
    expect(screen.getAllByText("View")).toHaveLength(3);
    expect(screen.queryByText("By rep")).toBeNull();
  });
});
