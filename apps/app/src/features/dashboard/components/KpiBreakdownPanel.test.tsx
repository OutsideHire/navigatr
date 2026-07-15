import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { KpiBreakdownPanel } from "./KpiBreakdownPanel";
import { formatMoney, type Deal } from "@/features/pipeline/mockData";

function deal(o: Partial<Deal> & { id: string }): Deal {
  return {
    id: o.id, companyName: o.id, contactName: "C", phone: "", email: "",
    valueCents: o.valueCents ?? 0, stage: o.stage ?? "qualified", probability: 50,
    lastActivity: "2026-07-01T00:00:00Z", nextFollowup: null, address: null,
    employeeCountRange: "1-9", leadSource: "", updatedAt: "2026-07-01T00:00:00Z",
    owner_id: o.owner_id ?? null, lostReasonCategory: null, lostReasonNotes: null,
  };
}

const DEALS = [
  deal({ id: "a", owner_id: "u1", stage: "qualified", valueCents: 30000 }),
  deal({ id: "b", owner_id: "u2", stage: "proposal", valueCents: 10000 }),
  deal({ id: "c", owner_id: null, stage: "new", valueCents: 5000 }),
];
const NAMES = new Map([["u1", "Sarah Lim"], ["u2", "Marcus Chen"]]);

// formatMoney values contain "$", a regex metacharacter — escape before embedding.
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("KpiBreakdownPanel", () => {
  it("renders rows sorted desc with money values + a range band", () => {
    render(<KpiBreakdownPanel title="Pipeline value by rep" metric="pipelineValue" deals={DEALS} memberNames={NAMES} onSelectRep={vi.fn()} />);
    expect(screen.getByText("Sarah Lim")).toBeInTheDocument();
    expect(screen.getByText(formatMoney(30000))).toBeInTheDocument();
    expect(screen.getByText("Marcus Chen")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Range across reps: ${escRe(formatMoney(5000))}.${escRe(formatMoney(30000))}`))).toBeTruthy();
  });

  it("a real-owner row navigates via onSelectRep; unassigned is not a button", () => {
    const onSelectRep = vi.fn();
    render(<KpiBreakdownPanel title="t" metric="pipelineValue" deals={DEALS} memberNames={NAMES} onSelectRep={onSelectRep} />);
    fireEvent.click(screen.getByRole("button", { name: /Sarah Lim/ }));
    expect(onSelectRep).toHaveBeenCalledWith("u1");
    expect(screen.queryByRole("button", { name: /Unassigned/ })).toBeNull();
  });

  it("shows an empty state when there's no data for the metric", () => {
    render(<KpiBreakdownPanel title="Won by rep" metric="won" deals={DEALS} memberNames={NAMES} onSelectRep={vi.fn()} />);
    expect(screen.getByText(/No data for this metric yet/)).toBeInTheDocument();
  });
});
