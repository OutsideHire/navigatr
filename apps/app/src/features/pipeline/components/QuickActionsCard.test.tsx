import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QuickActionsCard } from "./QuickActionsCard";

describe("QuickActionsCard", () => {
  it("renders the four quick actions", () => {
    render(<QuickActionsCard />);
    expect(screen.getByRole("button", { name: /send to crm/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send as referral/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /schedule appointment/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mark as lost/i })).toBeInTheDocument();
  });
  it("disables the not-yet-built actions", () => {
    render(<QuickActionsCard />);
    expect(screen.getByRole("button", { name: /send to crm/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /send as referral/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /schedule appointment/i })).toBeDisabled();
  });
  it("disables Mark as lost when no handler is provided", () => {
    render(<QuickActionsCard />);
    expect(screen.getByRole("button", { name: /mark as lost/i })).toBeDisabled();
  });
  it("enables Mark as lost and fires the handler when provided", () => {
    const onMarkLost = vi.fn();
    render(<QuickActionsCard onMarkLost={onMarkLost} />);
    const btn = screen.getByRole("button", { name: /mark as lost/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onMarkLost).toHaveBeenCalledTimes(1);
  });

  it("enables Send as referral and fires the handler when provided", () => {
    const onSendReferral = vi.fn();
    render(<QuickActionsCard onSendReferral={onSendReferral} />);
    const btn = screen.getByRole("button", { name: /send as referral/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onSendReferral).toHaveBeenCalledTimes(1);
  });
});
