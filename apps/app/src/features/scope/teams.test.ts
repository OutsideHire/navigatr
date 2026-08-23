import { describe, it, expect } from "vitest";
import { deriveTeams, spansMultipleTeams, DIRECT_TEAM_ID, type TeamRosterRow } from "./teams";

function row(over: Partial<TeamRosterRow> & { agent_id: string }): TeamRosterRow {
  return { full_name: over.agent_id, email: `${over.agent_id}@e.co`, manager_id: null, status: "active", ...over };
}

describe("deriveTeams", () => {
  it("a first-line manager over ICs has ONE team (no split) -> no team filter", () => {
    // me -> r1, r2 (both ICs)
    const rows = [row({ agent_id: "me" }), row({ agent_id: "r1", manager_id: "me" }), row({ agent_id: "r2", manager_id: "me" })];
    const teams = deriveTeams(rows, "me");
    expect(teams).toHaveLength(1);
    expect(teams[0].id).toBe(DIRECT_TEAM_ID);
    expect(teams[0].memberIds.sort()).toEqual(["r1", "r2"]);
    expect(spansMultipleTeams(teams)).toBe(false);
  });

  it("a director over two managers spans two teams, each carrying its subtree", () => {
    // dir -> mgrA -> a1 ; dir -> mgrB -> b1, b2
    const rows = [
      row({ agent_id: "dir" }),
      row({ agent_id: "mgrA", full_name: "Alpha", manager_id: "dir" }),
      row({ agent_id: "a1", manager_id: "mgrA" }),
      row({ agent_id: "mgrB", full_name: "Bravo", manager_id: "dir" }),
      row({ agent_id: "b1", manager_id: "mgrB" }),
      row({ agent_id: "b2", manager_id: "mgrB" }),
    ];
    const teams = deriveTeams(rows, "dir");
    expect(teams.map((t) => t.name)).toEqual(["Alpha", "Bravo"]);
    expect(teams[0].memberIds.sort()).toEqual(["a1", "mgrA"]);
    expect(teams[1].memberIds.sort()).toEqual(["b1", "b2", "mgrB"]);
    expect(spansMultipleTeams(teams)).toBe(true);
  });

  it("mixes manager teams with a 'Direct reports' bucket for direct ICs", () => {
    // dir -> mgrA -> a1 ; dir -> ic1 (IC direct report)
    const rows = [
      row({ agent_id: "dir" }),
      row({ agent_id: "mgrA", full_name: "Alpha", manager_id: "dir" }),
      row({ agent_id: "a1", manager_id: "mgrA" }),
      row({ agent_id: "ic1", manager_id: "dir" }),
    ];
    const teams = deriveTeams(rows, "dir");
    expect(teams.map((t) => t.name)).toEqual(["Alpha", "Direct reports"]);
    expect(teams[1].id).toBe(DIRECT_TEAM_ID);
    expect(teams[1].memberIds).toEqual(["ic1"]);
  });

  it("excludes non-active members and returns [] for an unknown viewer", () => {
    const rows = [row({ agent_id: "me" }), row({ agent_id: "inv", manager_id: "me", status: "invited" })];
    expect(deriveTeams(rows, "me")).toEqual([]);
    expect(deriveTeams(rows, undefined)).toEqual([]);
  });
});
