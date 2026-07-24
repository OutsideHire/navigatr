import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ActivityToWinReport } from "./ActivityToWinReport";
import type { Deal, DealStage } from "@/features/pipeline/mockData";
import type { Activity, ActivityType } from "@/features/activities/mockData";

vi.mock("@/features/pipeline/hooks/useDeals", () => ({ useDeals: () => ({ data: deals }) }));
vi.mock("@/features/activities/hooks/useActivities", () => ({ useActivitiesForOrg: () => ({ data: activities }) }));
vi.mock("@/features/auth/useProfile", () => ({ useProfile: () => ({ data: { role: "admin" } }) }));
vi.mock("../hooks/useOrgMemberNames", () => ({ useOrgMemberNames: () => new Map() }));
vi.mock("@/stores/auth", () => ({ useAuth: (sel: (s: { user: { id: string } }) => unknown) => sel({ user: { id: "u1" } }) }));

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function buildDeal(o: { id: string; companyName: string; stage: DealStage; valueCents: number; owner_id: string | null }): Deal {
  return {
    id: o.id,
    companyName: o.companyName,
    contactName: "Contact",
    phone: "+15555550100",
    email: "contact@example.com",
    valueCents: o.valueCents,
    stage: o.stage,
    probability: 50,
    lastActivity: daysAgo(1),
    nextFollowup: null,
    address: null,
    employeeCountRange: "1-10",
    leadSource: "Cold",
    updatedAt: daysAgo(1),
    owner_id: o.owner_id,
    lostReasonCategory: null,
    lostReasonNotes: null,
  };
}

function buildActivity(o: { id: string; dealId: string; type: ActivityType; occurredAt: string }): Activity {
  return {
    id: o.id,
    dealId: o.dealId,
    type: o.type,
    durationMinutes: null,
    disposition: "positive_engagement",
    outcomeNotes: "",
    occurredAt: o.occurredAt,
    followUpDate: null,
    loggedBy: "u1",
    voiceNoteUrl: null,
  };
}

let deals: Deal[];
let activities: Activity[];

beforeEach(() => {
  deals = [
    buildDeal({ id: "d1", companyName: "Northside Diner", stage: "won", valueCents: 500_000, owner_id: "u1" }),
    buildDeal({ id: "d2", companyName: "Beacon Auto", stage: "lost", valueCents: 300_000, owner_id: "u1" }),
    buildDeal({ id: "d3", companyName: "Vista Payments", stage: "qualified", valueCents: 200_000, owner_id: "u2" }),
  ];
  activities = [
    buildActivity({ id: "a1", dealId: "d1", type: "call", occurredAt: daysAgo(1) }),
    buildActivity({ id: "a2", dealId: "d1", type: "email", occurredAt: daysAgo(2) }),
    buildActivity({ id: "a3", dealId: "d2", type: "call", occurredAt: daysAgo(1) }),
    buildActivity({ id: "a4", dealId: "d3", type: "drop_in", occurredAt: daysAgo(1) }),
  ];
});

function renderReport() {
  return render(
    <MemoryRouter initialEntries={["/dashboard/activity-to-win"]}>
      <ActivityToWinReport />
    </MemoryRouter>,
  );
}

describe("ActivityToWinReport (unified activity performance)", () => {
  it("renders the report heading", () => {
    renderReport();
    expect(screen.getByRole("heading", { name: "Activity performance" })).toBeInTheDocument();
  });

  it("defaults to the Won scope, showing the won-scope metric label", () => {
    renderReport();
    expect(screen.getByText("Revenue won")).toBeInTheDocument();
  });

  it("switches to All and Open scopes on pill click", () => {
    renderReport();
    fireEvent.click(screen.getByText("All"));
    expect(screen.getByText("Total activity")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Open"));
    expect(screen.getByText("Open pipeline")).toBeInTheDocument();
  });

  it("shows the reconciliation footer", () => {
    renderReport();
    expect(screen.getByText(/Reconciliation:/)).toBeInTheDocument();
  });

  it("shows the Export CSV button", () => {
    renderReport();
    expect(screen.getByRole("button", { name: /export csv/i })).toBeInTheDocument();
  });

  it("expands a rep row to reveal its company sub-table", () => {
    renderReport();
    // Default scope is Won: owner u1 (same as the signed-in user) shows as "You"
    // and is the only rep with a won deal (Northside Diner). The company row is
    // hidden until the rep row is expanded.
    expect(screen.queryByText("Northside Diner")).toBeNull();
    fireEvent.click(screen.getByText("You"));
    expect(screen.getByText("Northside Diner")).toBeInTheDocument();
  });
});
