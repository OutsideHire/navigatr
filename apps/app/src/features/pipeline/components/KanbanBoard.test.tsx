// Tests the kanban grouping: every deal lands in its stage column, the
// total-value-per-column math is right, and empty columns render their
// placeholder. The pipeline is the canonical "scan and act" surface for
// reps — wrong bucketing here would silently put real money in the wrong
// pile.

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { KanbanBoard } from "./KanbanBoard";
import type { Deal } from "../mockData";

function deal(id: string, stage: Deal["stage"], valueCents: number, company = `Co-${id}`): Deal {
  return {
    id,
    companyName: company,
    contactName: "X",
    phone: "+12025550100",
    email: "x@x.x",
    valueCents,
    stage,
    probability: 50,
    lastActivity: "2026-05-18T12:00:00Z",
    nextFollowup: null,
    employeeCountRange: "1-10",
  };
}

function renderBoard(deals: Deal[]) {
  return render(
    <MemoryRouter>
      <KanbanBoard deals={deals} />
    </MemoryRouter>,
  );
}

describe("KanbanBoard", () => {
  it("renders all 5 stage columns, even when some have no deals", () => {
    renderBoard([deal("a", "new", 100_00)]);
    for (const label of ["New", "Contacted", "Qualified", "Proposal", "Won"]) {
      expect(screen.getByLabelText(`${label} stage`)).toBeInTheDocument();
    }
  });

  it("buckets each deal into the correct stage column", () => {
    renderBoard([
      deal("a", "new",       100_00, "Acme"),
      deal("b", "qualified", 200_00, "Beta"),
      deal("c", "won",       300_00, "Gamma"),
    ]);
    const newCol = screen.getByLabelText("New stage");
    const qualifiedCol = screen.getByLabelText("Qualified stage");
    const wonCol = screen.getByLabelText("Won stage");

    expect(within(newCol).getByText("Acme")).toBeInTheDocument();
    expect(within(qualifiedCol).getByText("Beta")).toBeInTheDocument();
    expect(within(wonCol).getByText("Gamma")).toBeInTheDocument();

    // Cross-bucket check — Acme should NOT appear in any column other
    // than New.
    expect(within(qualifiedCol).queryByText("Acme")).toBeNull();
    expect(within(wonCol).queryByText("Acme")).toBeNull();
  });

  it("sums each column's total in tabular figures", () => {
    renderBoard([
      deal("a", "new", 5_00),    // $5
      deal("b", "new", 10_00),   // $10 — sum to $15, formatMoney rounds to "$15"
    ]);
    const newCol = screen.getByLabelText("New stage");
    // formatMoney formats $15 (cents 1500/100) as "$15"
    expect(within(newCol).getByText("$15")).toBeInTheDocument();
  });

  it("renders 'No deals' placeholder in an empty column", () => {
    renderBoard([deal("a", "new", 100_00)]);
    const wonCol = screen.getByLabelText("Won stage");
    expect(within(wonCol).getByText(/no deals/i)).toBeInTheDocument();
  });

  it("each deal card is a button (clickable to drill into detail)", () => {
    renderBoard([deal("a", "new", 100_00, "Acme")]);
    const newCol = screen.getByLabelText("New stage");
    // Find the card by company name then walk to the closest button.
    const acme = within(newCol).getByText("Acme");
    const btn = acme.closest("button");
    expect(btn).not.toBeNull();
  });
});
