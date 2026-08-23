/**
 * deriveTeams — turn a viewer's reporting subtree (the team_leaderboard roster)
 * into the "teams" the team filter and partner grouping operate on (PRD 6.12.A
 * Bundle 3, FR-HIER-21 / FR-HIER-25).
 *
 * A team is one branch beneath the viewer:
 *   - each DIRECT report who is themselves a manager (has reports) is a team,
 *     with all of that manager's descendants as members;
 *   - any direct reports who are individual contributors are collected into a
 *     single "Direct reports" team.
 * So a first-line manager whose reports are all ICs has ONE team (no team
 * filter); a Director over several managers spans several teams.
 *
 * The viewer themselves is not a member of any team (they are the root).
 */

export interface TeamRosterRow {
  agent_id: string;
  full_name: string | null;
  email: string;
  manager_id: string | null;
  status: "active" | "invited" | "revoked";
}

export interface Team {
  /** The team-root agent id, or DIRECT_TEAM_ID for the direct-IC bucket. */
  id: string;
  name: string;
  /** Every seller in the team (the root manager + descendants, or the ICs). */
  memberIds: string[];
}

export const DIRECT_TEAM_ID = "__direct_reports__";

export function deriveTeams(rows: TeamRosterRow[], viewerId: string | undefined): Team[] {
  if (!viewerId) return [];
  const active = rows.filter((r) => r.status === "active");
  const childrenOf = new Map<string, string[]>();
  const nameOf = new Map<string, string>();
  for (const r of active) {
    nameOf.set(r.agent_id, r.full_name ?? r.email);
    if (r.manager_id) {
      const list = childrenOf.get(r.manager_id) ?? [];
      list.push(r.agent_id);
      childrenOf.set(r.manager_id, list);
    }
  }

  const descendants = (id: string): string[] => {
    const out: string[] = [];
    const queue = [...(childrenOf.get(id) ?? [])];
    const seen = new Set<string>();
    while (queue.length) {
      const cur = queue.shift()!;
      if (seen.has(cur)) continue; // cycle guard
      seen.add(cur);
      out.push(cur);
      queue.push(...(childrenOf.get(cur) ?? []));
    }
    return out;
  };

  const directReports = childrenOf.get(viewerId) ?? [];
  const teams: Team[] = [];
  const directICs: string[] = [];
  for (const c of directReports) {
    if ((childrenOf.get(c) ?? []).length > 0) {
      teams.push({ id: c, name: nameOf.get(c) ?? c, memberIds: [c, ...descendants(c)] });
    } else {
      directICs.push(c);
    }
  }
  teams.sort((a, b) => a.name.localeCompare(b.name));
  if (directICs.length > 0) {
    teams.push({ id: DIRECT_TEAM_ID, name: "Direct reports", memberIds: directICs });
  }
  return teams;
}

/** A viewer "spans more than one team" (FR-HIER-21/25 trigger). */
export function spansMultipleTeams(teams: Team[]): boolean {
  return teams.length >= 2;
}

/** Member ids of the selected team, or null when no team is selected or the id
 *  is unknown (null = no team narrowing). */
export function teamMemberIds(teams: Team[], teamId: string | null): string[] | null {
  if (!teamId) return null;
  return teams.find((t) => t.id === teamId)?.memberIds ?? null;
}
