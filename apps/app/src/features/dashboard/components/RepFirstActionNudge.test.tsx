// RepFirstActionNudge is presentational: it renders the rep's first-run copy
// and two CTAs, and reports intent via callbacks (routing stays in the page).
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { RepFirstActionNudge } from "./RepFirstActionNudge";

describe("RepFirstActionNudge", () => {
  it("shows the first-move heading and both CTAs", () => {
    render(<RepFirstActionNudge onLogStop={vi.fn()} onAddDeal={vi.fn()} />);
    expect(screen.getByText(/first move/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /log your first stop/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add a deal/i })).toBeInTheDocument();
  });

  it("primary CTA fires onLogStop (the Path route)", async () => {
    const onLogStop = vi.fn();
    render(<RepFirstActionNudge onLogStop={onLogStop} onAddDeal={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /log your first stop/i }));
    expect(onLogStop).toHaveBeenCalledOnce();
  });

  it("secondary CTA fires onAddDeal (the pipeline route)", async () => {
    const onAddDeal = vi.fn();
    render(<RepFirstActionNudge onLogStop={vi.fn()} onAddDeal={onAddDeal} />);
    await userEvent.click(screen.getByRole("button", { name: /add a deal/i }));
    expect(onAddDeal).toHaveBeenCalledOnce();
  });
});
