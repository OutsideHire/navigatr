import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TeamCoverageCard } from "./TeamCoverageCard";
import type { CoverageRollupRow } from "../lib/teamCoverage";

let rows: CoverageRollupRow[];
vi.mock("../hooks/useCoverageRollup", () => ({
  useCoverageRollup: () => ({ rows, isLoading: false }),
}));

const row = (over: Partial<CoverageRollupRow> = {}): CoverageRollupRow => ({
  userId: "u", fullName: "Rep", role: "rep", snapshotDate: "2026-06-25",
  compositeCoverage: 0.8, confidenceLevel: "low", callCoverage: 0.8, callEventCount: 10,
  activeChannels: ["phone"], ...over,
});

beforeEach(() => { rows = []; });

describe("TeamCoverageCard", () => {
  it("shows the team headline band + reps-with-data and a chip per rep", () => {
    rows = [
      row({ userId: "a", fullName: "Alex", compositeCoverage: 0.82, callEventCount: 30 }),
      row({ userId: "b", fullName: "Sam", compositeCoverage: null, confidenceLevel: null, callEventCount: null }),
    ];
    render(<TeamCoverageCard />);
    expect(screen.getByText(/team logging coverage/i)).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 reps/i)).toBeInTheDocument();
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("Sam")).toBeInTheDocument();
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
    // headline pill (band label + rounded %) and Alex's gradeable chip
    expect(screen.getByText("Good · 82%")).toBeInTheDocument();
    expect(screen.getByText("Good 82%")).toBeInTheDocument();
  });

  it("shows the instructional empty state when no rep has gradeable data", () => {
    rows = [row({ fullName: "Sam", compositeCoverage: null, confidenceLevel: null, callEventCount: null })];
    render(<TeamCoverageCard />);
    expect(screen.getByText(/no team coverage data yet/i)).toBeInTheDocument();
    expect(screen.getByText("Sam")).toBeInTheDocument();
  });

  it("renders nothing when there are no reps at all", () => {
    rows = [];
    const { container } = render(<TeamCoverageCard />);
    expect(container).toBeEmptyDOMElement();
  });
});
