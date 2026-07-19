import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PersistenceIndexWidget } from "./PersistenceIndexWidget";
import type { PersistenceIndexResult } from "../lib/persistenceIndex";

let result: PersistenceIndexResult | null;
vi.mock("../hooks/usePersistenceIndex", () => ({
  usePersistenceIndex: () => result,
}));

const FULL_RESULT: PersistenceIndexResult = {
  composite: 82,
  followUp: { points: 34, max: 40, hasSample: true, completionRate: 0.85, dueCount: 12 },
  cadence: { points: 24, max: 30, hasSample: true, medianTouchesPerWeek: 3.1, activeDeals: 7 },
  responseVelocity: { comingSoon: true },
  windowDays: 30,
  targetScore: 75,
};

beforeEach(() => {
  result = null;
});

describe("PersistenceIndexWidget", () => {
  it("renders the composite score and component breakdown for a full result", () => {
    result = FULL_RESULT;
    render(<PersistenceIndexWidget />);
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.getByText("Follow-up discipline")).toBeInTheDocument();
    expect(screen.getByText("Touch cadence")).toBeInTheDocument();
    expect(screen.getByText("Response velocity")).toBeInTheDocument();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });

  it("shows the not-enough-data empty state when composite is null", () => {
    result = {
      composite: null,
      followUp: { points: 0, max: 40, hasSample: false, completionRate: null, dueCount: 0 },
      cadence: { points: 0, max: 30, hasSample: false, medianTouchesPerWeek: null, activeDeals: 0 },
      responseVelocity: { comingSoon: true },
      windowDays: 30,
      targetScore: 75,
    };
    render(<PersistenceIndexWidget />);
    expect(screen.getByText(/not enough data/i)).toBeInTheDocument();
  });
});
