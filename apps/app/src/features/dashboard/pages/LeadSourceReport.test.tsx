import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LeadSourceReport } from "./LeadSourceReport";
import type { Deal, DealStage } from "@/features/pipeline/mockData";

function daysAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}
function deal(o: { id: string; source: string; stage: DealStage; valueCents: number; won?: boolean }): Deal {
  return {
    id: o.id,
    leadSource: o.source,
    stage: o.stage,
    valueCents: o.valueCents,
    createdAt: daysAgoIso(20),
    closedWonAt: o.won ? daysAgoIso(5) : null,
    timeToWinCalendarDays: o.won ? 15 : null,
    owner_id: "u1",
  } as unknown as Deal;
}

const deals: Deal[] = [
  deal({ id: "d1", source: "path", stage: "won", valueCents: 120_000, won: true }),
  deal({ id: "d2", source: "path", stage: "qualified", valueCents: 80_000 }),
  deal({ id: "d3", source: "customer_referral", stage: "won", valueCents: 240_000, won: true }),
  deal({ id: "d4", source: "assigned", stage: "new", valueCents: 90_000 }),
];

vi.mock("@/features/pipeline/hooks/useDeals", () => ({ useDeals: () => ({ data: deals }) }));
vi.mock("@/features/activities/hooks/useActivities", () => ({ useActivitiesForOrg: () => ({ data: [] }) }));
vi.mock("@/features/auth/useProfile", () => ({ useProfile: () => ({ data: { role: "manager" } }) }));
vi.mock("@/stores/auth", () => ({ useAuth: (sel: (s: { user: { id: string } }) => unknown) => sel({ user: { id: "u1" } }) }));
vi.mock("../hooks/useOrgMemberNames", () => ({ useOrgMemberNames: () => new Map([["u1", "Alex Rep"]]) }));

function renderReport() {
  return render(
    <MemoryRouter>
      <LeadSourceReport />
    </MemoryRouter>,
  );
}

// The signature-flow chart also renders a hidden a11y table; the source
// performance table is the one carrying the "Set by" column.
function sourceTable() {
  return screen.getAllByRole("table").find((t) => within(t).queryByText("Set by") !== null)!;
}

describe("LeadSourceReport", () => {
  it("renders the heading, controls, and KPI cards", () => {
    renderReport();
    expect(screen.getByRole("heading", { name: /lead source performance/i })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /reporting window/i })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /attribution basis/i })).toBeInTheDocument();
    expect(screen.getByText("Leads created")).toBeInTheDocument();
    expect(screen.getByText("MRR won per lead")).toBeInTheDocument();
  });

  it("lists rep-sourced sources in the table by default (Assigned hidden in rep scope)", () => {
    renderReport();
    const table = sourceTable();
    expect(within(table).getByText("Path")).toBeInTheDocument();
    expect(within(table).getByText("Customer Referral")).toBeInTheDocument();
    // Assigned is not rep-sourced → hidden in the default "Rep sourced only" scope.
    expect(within(table).queryByText("Assigned")).toBeNull();
  });

  it("shows Assigned once the scope switches to All sources", () => {
    renderReport();
    fireEvent.click(screen.getByRole("button", { name: "All sources" }));
    const table = sourceTable();
    expect(within(table).getByText("Assigned")).toBeInTheDocument();
  });

  it("surfaces the mixed-cohort banner on the Won-in-period basis", () => {
    renderReport();
    fireEvent.click(screen.getByRole("button", { name: "Won in period" }));
    expect(screen.getByText(/win rate is not a valid ratio/i)).toBeInTheDocument();
  });

  it("opens the per-source drawer when a table row is clicked", () => {
    renderReport();
    const table = sourceTable();
    fireEvent.click(within(table).getByText("Path"));
    const drawer = screen.getByRole("dialog", { name: /Path detail/i });
    expect(within(drawer).getByText("System set source")).toBeInTheDocument();
    expect(within(drawer).getByText("Stage funnel")).toBeInTheDocument();
    expect(within(drawer).getByText(/Rep breakdown/i)).toBeInTheDocument();
  });
});
