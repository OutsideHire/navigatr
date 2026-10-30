import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PortalTermsText } from "./PortalTermsText";

describe("PortalTermsText", () => {
  it("names each scroll box after its own heading for screen readers, and keeps scrolling inside the box", () => {
    render(<PortalTermsText navigatrText="Navigatr body." isoText="ISO body." />);
    const navigatr = screen.getByRole("region", { name: "Navigatr Referral Portal Terms" });
    const iso = screen.getByRole("region", { name: "Partner terms" });
    expect(navigatr).toHaveTextContent("Navigatr body.");
    expect(iso).toHaveTextContent("ISO body.");
    for (const box of [navigatr, iso]) {
      expect(box).toHaveAttribute("tabindex", "0");
      expect(box.className).toContain("overscroll-contain");
      expect(box.className).toContain("overflow-y-auto");
    }
  });

  it("shows no partner terms region when the ISO has none", () => {
    render(<PortalTermsText navigatrText="Navigatr body." isoText="  " />);
    expect(screen.getByRole("region", { name: "Navigatr Referral Portal Terms" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Partner terms" })).not.toBeInTheDocument();
  });
});
