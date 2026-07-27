import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PersistenceIndexWidget } from "./PersistenceIndexWidget";
import type { PersistenceIndexResult, TeamPersistenceIndexResult } from "../lib/persistenceIndex";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

let individual: PersistenceIndexResult | null;
let team: TeamPersistenceIndexResult;
let role: "rep" | "manager" | "admin";

vi.mock("../hooks/usePersistenceIndex", () => ({ usePersistenceIndex: () => individual }));
vi.mock("../hooks/useTeamPersistenceIndex", () => ({ useTeamPersistenceIndex: () => team }));
vi.mock("@/features/auth/useProfile", () => ({ useProfile: () => ({ data: { role } }) }));

const indFull: PersistenceIndexResult = {
  composite: 82,
  insufficientData: false,
  followUp: { points: 34, max: 40, hasSample: true, completionRate: 0.85, dueCount: 12, belowFloor: false },
  cadence: { points: 24, max: 30, hasSample: true, medianTouchesPerWeek: 3.1, activeDeals: 7 },
  reEngagement: { points: 24, max: 30, hasSample: true, rate: 0.8, silentCount: 5, reEngagedCount: 4 },
  components: [
    { key: "followUp", label: "Follow-up discipline", points: 34, max: 40, hasSample: true, belowFloor: false },
    { key: "cadence", label: "Touch cadence", points: 24, max: 30, hasSample: true },
    { key: "reEngagement", label: "Re-engagement after silence", points: 24, max: 30, hasSample: true },
  ],
  caveats: { followUpBelowFloor: false },
  windowDays: 30, targetScore: 75, formulaVersion: 2,
};
const teamFull: TeamPersistenceIndexResult = {
  composite: 71,
  followUp: { points: 30, max: 40 }, cadence: { points: 22, max: 30 },
  reEngagement: { points: 20, max: 30, silentCount: 3, reEngagedCount: 2 },
  components: [
    { key: "followUp", label: "Follow-up discipline", points: 30, max: 40, hasSample: true },
    { key: "cadence", label: "Touch cadence", points: 22, max: 30, hasSample: true },
    { key: "reEngagement", label: "Re-engagement after silence", points: 20, max: 30, hasSample: true },
  ],
  repCount: 5, range: { min: 58, max: 88 },
  windowDays: 30, targetScore: 75,
};

beforeEach(() => { navigateMock.mockReset(); individual = indFull; team = teamFull; role = "rep"; });

describe("PersistenceIndexWidget", () => {
  it("opens the detail page when clicked", () => {
    role = "manager";
    render(<PersistenceIndexWidget />);
    fireEvent.click(screen.getByRole("button", { name: /persistence index/i }));
    expect(navigateMock).toHaveBeenCalledWith("/dashboard/persistence-index");
  });

  it("renders null for a rep role (manager-only for beta)", () => {
    role = "rep";
    const { container } = render(<PersistenceIndexWidget />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders for a manager role", () => {
    role = "manager";
    render(<PersistenceIndexWidget />);
    expect(screen.getByText(/persistence index/i)).toBeInTheDocument();
  });

  it("renders for an admin role", () => {
    role = "admin";
    render(<PersistenceIndexWidget />);
    expect(screen.getByText(/persistence index/i)).toBeInTheDocument();
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

  it("never renders response velocity or coming soon text, for rep or manager", () => {
    role = "rep";
    const { rerender } = render(<PersistenceIndexWidget />);
    expect(screen.queryByText(/response velocity/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();

    role = "manager";
    rerender(<PersistenceIndexWidget />);
    expect(screen.queryByText(/response velocity/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
  });

  it("manager sees a re-engagement after silence row when scored", () => {
    role = "manager";
    render(<PersistenceIndexWidget />);
    expect(screen.getByText("Re-engagement after silence")).toBeInTheDocument();
  });

  it("admin sees a re-engagement after silence row when scored", () => {
    role = "admin";
    render(<PersistenceIndexWidget />);
    expect(screen.getByText("Re-engagement after silence")).toBeInTheDocument();
  });

  it("shows the email-capture disclosure line for a manager", () => {
    role = "manager";
    render(<PersistenceIndexWidget />);
    expect(
      screen.getByText("Reflects calls, drop-ins, and appointments. Email is not yet captured automatically."),
    ).toBeInTheDocument();
  });

  it("shows the email-capture disclosure line for an admin", () => {
    role = "admin";
    render(<PersistenceIndexWidget />);
    expect(
      screen.getByText("Reflects calls, drop-ins, and appointments. Email is not yet captured automatically."),
    ).toBeInTheDocument();
  });
});
