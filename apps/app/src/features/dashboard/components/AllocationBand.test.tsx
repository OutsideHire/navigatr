import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AllocationBand } from "./AllocationBand";

const band = { won: 34, open: 20, lost: 9, total: 63 };

describe("AllocationBand", () => {
  it("renders the section header and total", () => {
    render(<AllocationBand band={band} scope="all" onScope={() => {}} />);
    expect(screen.getByText("Where the effort went")).toBeInTheDocument();
    expect(screen.getByText("63 activities logged")).toBeInTheDocument();
  });

  it("renders a segment per outcome (by title)", () => {
    render(<AllocationBand band={band} scope="all" onScope={() => {}} />);
    expect(screen.getByTitle("Won: 34 activities")).toBeInTheDocument();
    expect(screen.getByTitle("Open: 20 activities")).toBeInTheDocument();
    expect(screen.getByTitle("Lost: 9 activities")).toBeInTheDocument();
  });

  it("renders a legend with percentages and an All-activity total", () => {
    render(<AllocationBand band={band} scope="all" onScope={() => {}} />);
    expect(screen.getByText("(54%)")).toBeInTheDocument(); // 34/63
    expect(screen.getByText("All activity")).toBeInTheDocument();
  });

  it("sets scope to the clicked outcome", () => {
    const onScope = vi.fn();
    render(<AllocationBand band={band} scope="all" onScope={onScope} />);
    fireEvent.click(screen.getByTitle("Won: 34 activities"));
    expect(onScope).toHaveBeenCalledWith("won");
  });

  it("clicking the active segment returns to all", () => {
    const onScope = vi.fn();
    render(<AllocationBand band={band} scope="won" onScope={onScope} />);
    fireEvent.click(screen.getByTitle("Won: 34 activities"));
    expect(onScope).toHaveBeenCalledWith("all");
  });

  it("shows an empty state when no activity", () => {
    render(<AllocationBand band={{ won: 0, open: 0, lost: 0, total: 0 }} scope="all" onScope={() => {}} />);
    expect(screen.getByText(/No activity logged/i)).toBeInTheDocument();
  });

  it("omits a zero-count segment", () => {
    render(<AllocationBand band={{ won: 10, open: 0, lost: 5, total: 15 }} scope="all" onScope={() => {}} />);
    expect(screen.getByTitle("Won: 10 activities")).toBeInTheDocument();
    expect(screen.queryByTitle(/^Open:/)).not.toBeInTheDocument();
    expect(screen.getByTitle("Lost: 5 activities")).toBeInTheDocument();
  });

  it("marks the selected outcome with aria-pressed", () => {
    render(<AllocationBand band={band} scope="won" onScope={() => {}} />);
    expect(screen.getByTitle("Won: 34 activities")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTitle("Open: 20 activities")).toHaveAttribute("aria-pressed", "false");
  });
});
