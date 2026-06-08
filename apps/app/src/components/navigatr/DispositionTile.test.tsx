import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DispositionTile } from "./DispositionTile";

describe("DispositionTile", () => {
  it("default variant shows the title and description and hugs content (no fixed 130px height)", () => {
    const { container } = render(<DispositionTile tier="positive" title="Met with DM" description="Spoke to the decision maker" />);
    expect(screen.getByText("Met with DM")).toBeInTheDocument();
    expect(screen.getByText("Spoke to the decision maker")).toBeInTheDocument();
    // Tiles hug their content — a fixed min-height left ~70px of dead space per
    // tile and ballooned the drop-in grid into a long scroll.
    expect(container.querySelector(".min-h-\\[130px\\]")).toBeNull();
  });
  it("dense variant shows the title but NOT the description, and is not a 130px card", () => {
    const { container } = render(
      <DispositionTile tier="positive" title="Met with DM" description="hidden in dense" dense />,
    );
    expect(screen.getByText("Met with DM")).toBeInTheDocument();
    expect(screen.queryByText("hidden in dense")).not.toBeInTheDocument();
    expect(container.querySelector(".min-h-\\[130px\\]")).toBeNull();
  });
  it("reflects selected via aria-pressed in both variants", () => {
    const { rerender } = render(<DispositionTile tier="neutral" title="T" description="" selected dense />);
    expect(screen.getByRole("button", { name: /t/i })).toHaveAttribute("aria-pressed", "true");
    rerender(<DispositionTile tier="neutral" title="T" description="" />);
    expect(screen.getByRole("button", { name: /t/i })).toHaveAttribute("aria-pressed", "false");
  });
  it("fires onClick", () => {
    const onClick = vi.fn();
    render(<DispositionTile tier="cool" title="Other" description="" dense onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: /other/i }));
    expect(onClick).toHaveBeenCalled();
  });
  it("omitting description in the default variant renders no empty description node", () => {
    render(<DispositionTile tier="neutral" title="NoDesc" />);
    expect(screen.getByText("NoDesc")).toBeInTheDocument();
  });
});
