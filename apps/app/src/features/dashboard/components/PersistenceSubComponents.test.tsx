import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PersistenceSubComponents } from "./PersistenceSubComponents";

const rows = [
  { key: "followUp", label: "Follow-up discipline", points: 32, max: 40, peerPct: 61 },
  { key: "cadence", label: "Touch cadence", points: 20, max: 30, peerPct: 70 },
  { key: "reEngagement", label: "Re-engagement after silence", points: 24, max: 30, peerPct: 80 },
];

describe("PersistenceSubComponents", () => {
  it("renders all three rows with their points", () => {
    render(<PersistenceSubComponents rows={rows} />);
    expect(screen.getByText("Follow-up discipline")).toBeInTheDocument();
    expect(screen.getByText("32 / 40 · 80%")).toBeInTheDocument();
    expect(screen.getByText("Touch cadence")).toBeInTheDocument();
    expect(screen.getByText("20 / 30 · 67%")).toBeInTheDocument();
    expect(screen.getByText("Re-engagement after silence")).toBeInTheDocument();
    expect(screen.getByText("24 / 30 · 80%")).toBeInTheDocument();
  });

  it("never renders response velocity or coming soon text", () => {
    render(<PersistenceSubComponents rows={rows} />);
    expect(screen.queryByText(/response velocity/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
  });

  it("shows an insufficient-data caption when a row has no sample", () => {
    render(
      <PersistenceSubComponents
        rows={rows.map((r) => ({ ...r, points: null }))}
      />,
    );
    expect(screen.getAllByText(/Not enough data/i).length).toBeGreaterThan(0);
  });

  it("renders a footnote when provided", () => {
    render(<PersistenceSubComponents rows={rows} footnote="Some footnote text." />);
    expect(screen.getByText("Some footnote text.")).toBeInTheDocument();
  });

  it("renders no footnote paragraph when omitted", () => {
    render(<PersistenceSubComponents rows={rows} />);
    expect(screen.queryByText("Some footnote text.")).not.toBeInTheDocument();
  });

  it("renders the eligible/recovered counts near the re-engagement row when provided", () => {
    render(
      <PersistenceSubComponents
        rows={rows.map((r) =>
          r.key === "reEngagement" ? { ...r, counts: { silentCount: 5, reEngagedCount: 3 } } : r,
        )}
      />,
    );
    expect(screen.getByText("5 went quiet, 3 brought back")).toBeInTheDocument();
  });

  it("renders no counts line when a row's counts are omitted", () => {
    render(<PersistenceSubComponents rows={rows} />);
    expect(screen.queryByText(/went quiet/i)).not.toBeInTheDocument();
  });
});
