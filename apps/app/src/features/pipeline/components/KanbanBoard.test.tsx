// Kanban grouping + redesigned card. 6 active columns (no Lost), each card shows
// company + value + a probability bar, and a "+ Add to {stage}" footer button.
//
// Real pointer-drag is verified manually in-browser: jsdom can't simulate
// @dnd-kit's pointer sensors, so the drop is not driven here. The pure drop
// decision is unit-tested in ../lib/resolveDrop.test.ts.
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { KanbanBoard } from "./KanbanBoard";
import type { Deal } from "../mockData";

function deal(id: string, stage: Deal["stage"], valueCents: number, company = `Co-${id}`): Deal {
  return {
    id, companyName: company, contactName: "X", phone: "+12025550100", email: "x@x.x",
    valueCents, stage, probability: 50, lastActivity: "2026-05-18T12:00:00Z", nextFollowup: null,
    address: null, employeeCountRange: "1-10", leadSource: "", updatedAt: "2026-05-18T12:00:00Z",
    owner_id: null, lostReasonCategory: null, lostReasonNotes: null,
  };
}

function renderBoard(deals: Deal[], onAddToStage?: (s: Deal["stage"]) => void) {
  return render(<MemoryRouter><KanbanBoard deals={deals} onAddToStage={onAddToStage} /></MemoryRouter>);
}

describe("KanbanBoard", () => {
  it("renders the 6 active stage columns and NOT a Lost column", () => {
    renderBoard([deal("a", "new", 100_00)]);
    for (const label of ["New", "Contacted", "Qualified", "Proposal", "Submitted", "Won"]) {
      expect(screen.getByLabelText(`${label} stage`)).toBeInTheDocument();
    }
    expect(screen.queryByLabelText("Lost stage")).toBeNull();
  });

  it("buckets each deal into the correct stage column", () => {
    renderBoard([
      deal("a", "new", 100_00, "Acme"),
      deal("b", "qualified", 200_00, "Beta"),
      deal("c", "won", 300_00, "Gamma"),
    ]);
    expect(within(screen.getByLabelText("New stage")).getByText("Acme")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Qualified stage")).getByText("Beta")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Won stage")).getByText("Gamma")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Qualified stage")).queryByText("Acme")).toBeNull();
  });

  it("shows each column's count and total", () => {
    renderBoard([deal("a", "new", 5_00), deal("b", "new", 10_00)]);
    const newCol = screen.getByLabelText("New stage");
    expect(within(newCol).getByText(/\$15/)).toBeInTheDocument();
    expect(within(newCol).getByText(/^2 ·/)).toBeInTheDocument();
  });

  it("renders a probability bar on each card", () => {
    renderBoard([deal("a", "new", 100_00)]);
    const newCol = screen.getByLabelText("New stage");
    const bar = within(newCol).getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "50");
  });

  it("renders 'No deals' in an empty column", () => {
    renderBoard([deal("a", "new", 100_00)]);
    expect(within(screen.getByLabelText("Won stage")).getByText(/no deals/i)).toBeInTheDocument();
  });

  it("each deal card is a clickable role=button (dnd-kit draggable)", () => {
    renderBoard([deal("a", "new", 100_00, "Acme")]);
    expect(
      within(screen.getByLabelText("New stage")).getByText("Acme").closest('[role="button"]'),
    ).not.toBeNull();
  });

  it("'+ Add to {stage}' calls onAddToStage with that stage", () => {
    const onAdd = vi.fn();
    renderBoard([deal("a", "new", 100_00)], onAdd);
    fireEvent.click(within(screen.getByLabelText("Qualified stage")).getByRole("button", { name: /add to qualified/i }));
    expect(onAdd).toHaveBeenCalledWith("qualified");
  });

  it("omits the add button when onAddToStage is not provided", () => {
    renderBoard([deal("a", "new", 100_00)]);
    expect(screen.queryByRole("button", { name: /add to/i })).toBeNull();
  });
});
