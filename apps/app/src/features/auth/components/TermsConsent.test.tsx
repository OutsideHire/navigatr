import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TermsConsent } from "./TermsConsent";

function renderConsent(props: Partial<React.ComponentProps<typeof TermsConsent>> = {}) {
  render(
    <MemoryRouter>
      <TermsConsent checked={false} onCheckedChange={vi.fn()} {...props} />
    </MemoryRouter>,
  );
}

describe("TermsConsent", () => {
  it("renders the agreement checkbox and links to Terms + Privacy in new tabs", () => {
    renderConsent();
    expect(screen.getByRole("checkbox", { name: /i agree to the terms/i })).toBeInTheDocument();
    const terms = screen.getByRole("link", { name: /terms of service/i });
    const privacy = screen.getByRole("link", { name: /privacy policy/i });
    expect(terms).toHaveAttribute("href", "/terms");
    expect(privacy).toHaveAttribute("href", "/privacy");
    expect(terms).toHaveAttribute("target", "_blank");
    expect(privacy).toHaveAttribute("target", "_blank");
  });

  it("reports toggling via onCheckedChange", async () => {
    const onCheckedChange = vi.fn();
    renderConsent({ onCheckedChange });
    await userEvent.click(screen.getByRole("checkbox", { name: /i agree/i }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("reflects the checked state it is given", () => {
    renderConsent({ checked: true });
    expect(screen.getByRole("checkbox", { name: /i agree/i })).toBeChecked();
  });

  it("shows the validation error as an alert when provided", () => {
    renderConsent({ error: "Please agree to continue" });
    expect(screen.getByRole("alert")).toHaveTextContent(/please agree to continue/i);
  });
});
