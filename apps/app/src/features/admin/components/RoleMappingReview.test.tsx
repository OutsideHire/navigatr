import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { RoleMappingReview } from "./RoleMappingReview";
import type { ParsedAgent } from "../utils/parseAgentsCsv";

// Radix Select (portal listbox) needs these jsdom shims to open + pick options.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

const row = (email: string, roleText: string, over: Partial<ParsedAgent> = {}): ParsedAgent => ({
  email,
  full_name: null,
  roleText,
  ...over,
});

describe("RoleMappingReview", () => {
  it("auto-matches recognized roles and sends the resolved levels", async () => {
    const onConfirm = vi.fn();
    render(
      <RoleMappingReview
        valid={[row("a@x.com", "Sales Professional", { full_name: "Alice" }), row("b@x.com", "VP of Sales", { full_name: "Bob" })]}
        errors={[]}
        onBack={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getAllByText(/matched/i)).toHaveLength(2);
    const send = screen.getByRole("button", { name: /send 2 invites/i });
    expect(send).toBeEnabled();
    await userEvent.click(send);
    expect(onConfirm).toHaveBeenCalledWith([
      { email: "a@x.com", full_name: "Alice", role_level: "sales_professional" },
      { email: "b@x.com", full_name: "Bob", role_level: "vp_sales" },
    ]);
  });

  it("blocks sending until an unrecognized role is mapped", () => {
    render(
      <RoleMappingReview
        valid={[row("a@x.com", "Sales Professional"), row("c@x.com", "Account Executive")]}
        errors={[]}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText("Account Executive")).toBeInTheDocument();
    expect(screen.getByText("Needs a match")).toBeInTheDocument();
    expect(screen.getByText(/1 role still needs a match/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send 2 invites/i })).toBeDisabled();
  });

  it("lets the admin map an unrecognized role, which enables sending with the chosen level", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <RoleMappingReview
        valid={[row("a@x.com", "Sales Professional", { full_name: "Alice" }), row("c@x.com", "Account Executive", { full_name: "Cara" })]}
        errors={[]}
        onBack={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: /map account executive/i }));
    await user.click(await screen.findByRole("option", { name: "Sales Manager" }));

    const send = screen.getByRole("button", { name: /send 2 invites/i });
    expect(send).toBeEnabled();
    await user.click(send);
    expect(onConfirm).toHaveBeenCalledWith([
      { email: "a@x.com", full_name: "Alice", role_level: "sales_professional" },
      { email: "c@x.com", full_name: "Cara", role_level: "sales_manager" },
    ]);
  });

  it("shows a skip list for email-problem rows", () => {
    render(
      <RoleMappingReview
        valid={[row("a@x.com", "Sales Professional")]}
        errors={[{ row: 3, reason: "missing_email", raw: ",No Email" }]}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText(/1 row will be skipped/i)).toBeInTheDocument();
  });
});
