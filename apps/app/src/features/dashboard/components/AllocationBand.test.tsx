import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AllocationBand } from "./AllocationBand";

const band = { won: 34, open: 20, lost: 9, total: 63 };

describe("AllocationBand", () => {
  it("renders a segment per outcome with counts", () => {
    render(<AllocationBand band={band} scope="all" onScope={() => {}} />);
    expect(screen.getByText("Won · 34")).toBeInTheDocument();
    expect(screen.getByText("Open · 20")).toBeInTheDocument();
    expect(screen.getByText("Lost · 9")).toBeInTheDocument();
  });
  it("sets scope to the clicked outcome", () => {
    const onScope = vi.fn();
    render(<AllocationBand band={band} scope="all" onScope={onScope} />);
    fireEvent.click(screen.getByText("Won · 34"));
    expect(onScope).toHaveBeenCalledWith("won");
  });
  it("clicking the active segment returns to all", () => {
    const onScope = vi.fn();
    render(<AllocationBand band={band} scope="won" onScope={onScope} />);
    fireEvent.click(screen.getByText("Won · 34"));
    expect(onScope).toHaveBeenCalledWith("all");
  });
  it("shows an empty state when no activity", () => {
    render(<AllocationBand band={{ won: 0, open: 0, lost: 0, total: 0 }} scope="all" onScope={() => {}} />);
    expect(screen.getByText(/No activity logged/i)).toBeInTheDocument();
  });
  it("omits a zero-count segment", () => {
    render(<AllocationBand band={{ won: 10, open: 0, lost: 5, total: 15 }} scope="all" onScope={() => {}} />);
    expect(screen.getByText("Won · 10")).toBeInTheDocument();
    expect(screen.queryByText(/Open ·/)).not.toBeInTheDocument();
    expect(screen.getByText("Lost · 5")).toBeInTheDocument();
  });
  it("marks the active segment with aria-pressed", () => {
    render(<AllocationBand band={band} scope="won" onScope={() => {}} />);
    expect(screen.getByText("Won · 34").closest("button")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Open · 20").closest("button")).toHaveAttribute("aria-pressed", "false");
  });
});
