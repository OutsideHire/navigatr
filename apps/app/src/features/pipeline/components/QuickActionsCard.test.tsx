import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
