import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PersistenceIndexWidget } from "./PersistenceIndexWidget";
import type { PersistenceIndexResult, TeamPersistenceIndexResult } from "../lib/persistenceIndex";

let individual: PersistenceIndexResult | null;
let team: TeamPersistenceIndexResult;
let role: "rep" | "manager" | "admin";

vi.mock("../hooks/usePersistenceIndex", () => ({ usePersistenceIndex: () => individual }));
vi.mock("../hooks/useTeamPersistenceIndex", () => ({ useTeamPersistenceIndex: () => team }));
vi.mock("@/features/auth/useProfile", () => ({ useProfile: () => ({ data: { role } }) }));

const indFull: PersistenceIndexResult = {
  composite: 82,
  followUp: { points: 34, max: 40, hasSample: true, completionRate: 0.85, dueCount: 12 },
  cadence: { points: 24, max: 30, hasSample: true, medianTouchesPerWeek: 3.1, activeDeals: 7 },
  responseVelocity: { comingSoon: true }, windowDays: 30, targetScore: 75,
};
const teamFull: TeamPersistenceIndexResult = {
  composite: 71,
  followUp: { points: 30, max: 40 }, cadence: { points: 22, max: 30 },
  responseVelocity: { comingSoon: true }, repCount: 5, range: { min: 58, max: 88 },
  windowDays: 30, targetScore: 75,
};

beforeEach(() => { individual = indFull; team = teamFull; role = "rep"; });

describe("PersistenceIndexWidget", () => {
  it("rep sees the individual score", () => {
    role = "rep";
    render(<PersistenceIndexWidget />);
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });

  it("rep empty state when composite is null", () => {
    role = "rep"; individual = { ...indFull, composite: null };
    render(<PersistenceIndexWidget />);
    expect(screen.getByText(/not enough data/i)).toBeInTheDocument();
  });

  it("manager sees the team aggregate with rep count and range", () => {
    role = "manager";
    render(<PersistenceIndexWidget />);
    expect(screen.getByText("71")).toBeInTheDocument();
    expect(screen.getByText(/5 reps/i)).toBeInTheDocument();
    expect(screen.getByText(/58/)).toBeInTheDocument();
    expect(screen.getByText(/88/)).toBeInTheDocument();
  });

  it("manager team empty state when no rep has a score", () => {
    role = "manager"; team = { ...teamFull, composite: null, repCount: 0, range: null };
    render(<PersistenceIndexWidget />);
    expect(screen.getByText(/not enough data/i)).toBeInTheDocument();
  });
});
