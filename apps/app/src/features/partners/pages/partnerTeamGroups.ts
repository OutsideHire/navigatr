/**
 * groupPartnersByTeam — group a scoped partner list under team headings with
 * per-team subtotals (PRD 6.12.A Bundle 3, FR-HIER-25). Used only when the
 * viewer spans more than one team and no seller/team filter has narrowed the
 * view to one; otherwise the list stays flat.
 *
 * A partner is placed in the team its owner belongs to. A partner owned by the
 * viewer themselves falls under "You"; anything else (owner outside every team)
 * falls under "Other". Team groups keep the caller's team order; "You" and
 * "Other" sort last.
 */

import type { Partner } from "../mockData";
import type { Team } from "@/features/scope/teams";

export interface PartnerTeamGroup {
  key: string;
  name: string;
  partners: Partner[];
}

const YOU = "__you__";
const OTHER = "__other__";

export function groupPartnersByTeam(
  partners: Partner[],
  teams: Team[],
  viewerId: string | undefined,
): PartnerTeamGroup[] {
  const teamIdByOwner = new Map<string, string>();
  const nameByTeamId = new Map<string, string>();
  for (const t of teams) {
    nameByTeamId.set(t.id, t.name);
    for (const m of t.memberIds) teamIdByOwner.set(m, t.id);
  }

  const buckets = new Map<string, Partner[]>();
  const push = (key: string, p: Partner) => {
    const list = buckets.get(key) ?? [];
    list.push(p);
    buckets.set(key, list);
  };
  for (const p of partners) {
    const oid = p.ownerId ?? null;
    if (oid && teamIdByOwner.has(oid)) push(teamIdByOwner.get(oid)!, p);
    else if (oid && viewerId && oid === viewerId) push(YOU, p);
    else push(OTHER, p);
  }

  const result: PartnerTeamGroup[] = [];
  for (const t of teams) {
    const list = buckets.get(t.id);
    if (list?.length) result.push({ key: t.id, name: nameByTeamId.get(t.id) ?? t.id, partners: list });
  }
  const you = buckets.get(YOU);
  if (you?.length) result.push({ key: YOU, name: "You", partners: you });
  const other = buckets.get(OTHER);
  if (other?.length) result.push({ key: OTHER, name: "Other", partners: other });
  return result;
}
