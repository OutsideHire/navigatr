import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CoverageWidget } from "./CoverageWidget";
import type { CoverageSnapshot } from "../hooks/useCoverageSnapshots";

let latest: CoverageSnapshot | null;
let series: CoverageSnapshot[];
vi.mock("../hooks/useCoverageSnapshots", () => ({
  useCoverageSnapshots: () => ({ latest, series, isLoading: false }),
}));

const snap = (over: Partial<CoverageSnapshot> = {}): CoverageSnapshot => ({
  snapshotDate: "2026-06-24", compositeCoverage: 0.8, confidenceLevel: "high",
  callCoverage: 0.8, callEventCount: 10, activeChannels: ["phone"], ...over,
});

beforeEach(() => { latest = null; series = []; });

describe("CoverageWidget", () => {
  it("shows the instructional empty state when there is no snapshot", () => {
    render(<CoverageWidget />);
    expect(screen.getByText(/logging coverage/i)).toBeInTheDocument();
    expect(screen.getByText(/no coverage data yet/i)).toBeInTheDocument();
  });

  it("treats insufficient confidence as the empty state (no %)", () => {
    latest = snap({ confidenceLevel: "insufficient", compositeCoverage: 0.25 });
    render(<CoverageWidget />);
    expect(screen.getByText(/no coverage data yet/i)).toBeInTheDocument();
    expect(screen.queryByText("25%")).not.toBeInTheDocument();
  });

  it("renders the band % with a low-confidence qualifier for thin data", () => {
    latest = snap({ confidenceLevel: "low", compositeCoverage: 0.78, callEventCount: 18, callCoverage: 0.78 });
    series = [snap({ snapshotDate: "2026-06-23", compositeCoverage: 0.7 }), latest];
    render(<CoverageWidget />);
    expect(screen.getByText("78%")).toBeInTheDocument();
    expect(screen.getByText(/estimated · low confidence/i)).toBeInTheDocument();
    expect(screen.getByText(/phone/i)).toBeInTheDocument();
  });

  it("uses the bare 'Estimated' qualifier for medium confidence", () => {
    latest = snap({ confidenceLevel: "medium", compositeCoverage: 0.82 });
    render(<CoverageWidget />);
    expect(screen.getByText("82%")).toBeInTheDocument();
    expect(screen.getByText("Estimated")).toBeInTheDocument();
    expect(screen.queryByText(/low confidence/i)).not.toBeInTheDocument();
  });

  it("renders the % with no qualifier for high confidence", () => {
    latest = snap({ confidenceLevel: "high", compositeCoverage: 0.92 });
    render(<CoverageWidget />);
    expect(screen.getByText("92%")).toBeInTheDocument();
    expect(screen.queryByText(/estimated/i)).not.toBeInTheDocument();
  });

  it("omits the sparkline with fewer than 2 snapshots", () => {
    latest = snap({ confidenceLevel: "high" });
    series = [latest];
    render(<CoverageWidget />);
    expect(screen.queryByTestId("coverage-sparkline")).not.toBeInTheDocument();
  });

  it("shows the sparkline with 2+ snapshots", () => {
    latest = snap({ confidenceLevel: "high" });
    series = [snap({ snapshotDate: "2026-06-23", compositeCoverage: 0.6 }), latest];
    render(<CoverageWidget />);
    expect(screen.getByTestId("coverage-sparkline")).toBeInTheDocument();
  });

  it("opens the methodology popover", () => {
    latest = snap({ confidenceLevel: "high" });
    render(<CoverageWidget />);
    fireEvent.click(screen.getByRole("button", { name: /how is this calculated/i }));
    expect(screen.getByText(/within 4 hours/i)).toBeInTheDocument();
  });
});
