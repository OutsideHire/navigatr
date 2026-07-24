import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PersistenceSubComponents } from "./PersistenceSubComponents";

describe("PersistenceSubComponents", () => {
  it("renders follow-up and cadence with points and a coming-soon response velocity row", () => {
    render(
      <PersistenceSubComponents
        followUpPoints={32}
        cadencePoints={20}
        peerFollowUpPct={61}
        peerCadencePct={70}
      />,
    );
    expect(screen.getByText("Follow-up discipline")).toBeInTheDocument();
    expect(screen.getByText("32 / 40 · 80%")).toBeInTheDocument();
    expect(screen.getByText("Touch cadence")).toBeInTheDocument();
    expect(screen.getByText("20 / 30 · 67%")).toBeInTheDocument();
    expect(screen.getByText("Response velocity")).toBeInTheDocument();
    expect(screen.getByText(/Coming soon/i)).toBeInTheDocument();
  });
  it("shows an insufficient-data caption when a component has no sample", () => {
    render(<PersistenceSubComponents followUpPoints={null} cadencePoints={null} peerFollowUpPct={null} peerCadencePct={null} />);
    expect(screen.getAllByText(/Not enough data/i).length).toBeGreaterThan(0);
  });
});
