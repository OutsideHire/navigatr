import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { TeamFilter, ALL_TEAMS } from "./TeamFilter";

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

const teams = [
  { id: "mgrA", name: "Alpha", memberIds: ["mgrA", "a1"] },
  { id: "mgrB", name: "Bravo", memberIds: ["mgrB", "b1"] },
];

describe("TeamFilter", () => {
  it("shows 'All teams' when nothing is selected", () => {
    render(<TeamFilter teams={teams} value={null} onChange={vi.fn()} />);
    expect(screen.getByText("All teams")).toBeInTheDocument();
  });

  it("shows the selected team name on the trigger", () => {
    render(<TeamFilter teams={teams} value="mgrB" onChange={vi.fn()} />);
    expect(screen.getByText("Bravo")).toBeInTheDocument();
  });

  it("exposes ALL_TEAMS as the clear sentinel", () => {
    expect(ALL_TEAMS).toBe("__all_teams__");
  });
});
