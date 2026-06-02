import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CreatePathWizard } from "./CreatePathWizard";

// The "Create path" wizard's industry control must speak the rep's language —
// no internal taxonomy jargon ("Tier 1") leaking into the UI, and the default
// set must name what it includes so the rep isn't guessing.

function renderWizard() {
  return render(
    <CreatePathWizard
      open
      onOpenChange={() => {}}
      origin={{ lat: 0, lng: 0 }}
      merchants={[]}
      radiusM={8047}
      onRadiusChange={() => {}}
      onIndustriesChange={() => {}}
      onStart={() => {}}
    />,
  );
}

describe("CreatePathWizard industries control", () => {
  it("uses plain 'Recommended' language, not internal 'Tier 1' jargon", () => {
    renderWizard();
    expect(screen.getByRole("button", { name: "Recommended" })).toBeInTheDocument();
    expect(screen.queryByText(/tier 1/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/tier-1/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/default \(tier/i)).not.toBeInTheDocument();
  });

  it("names what the Recommended set covers so the rep isn't guessing", () => {
    renderWizard();
    // Subtext starts "Recommended covers Manufacturing · …" — one unique node.
    expect(screen.getByText(/Recommended covers Manufacturing/i)).toBeInTheDocument();
    expect(screen.getByText(/or pick specific industries/i)).toBeInTheDocument();
  });
});
