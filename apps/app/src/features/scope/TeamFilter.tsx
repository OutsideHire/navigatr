/**
 * TeamFilter — the shared "view a specific team" control for Pipeline and
 * Partners (PRD 6.12.A Bundle 3, FR-HIER-21). Rendered only for viewers whose
 * scope spans more than one team, and sits above the SellerFilter. Controlled:
 * the page owns the `team` URL param and, per spec, resets the seller filter
 * whenever the team selection changes.
 */

import { Select } from "@/components/navigatr";
import type { Team } from "./teams";

export const ALL_TEAMS = "__all_teams__";

export function TeamFilter({
  teams,
  value,
  onChange,
  ariaLabel = "Filter by team",
}: {
  teams: Team[];
  /** Selected team id, or null for "All teams". */
  value: string | null;
  onChange: (teamId: string | null) => void;
  ariaLabel?: string;
}) {
  const options = [
    { value: ALL_TEAMS, label: "All teams" },
    ...teams.map((t) => ({ value: t.id, label: t.name })),
  ];
  return (
    <Select
      value={value ?? ALL_TEAMS}
      onValueChange={(v) => onChange(v === ALL_TEAMS ? null : v)}
      options={options}
      aria-label={ariaLabel}
      fullWidth={false}
      size="sm"
    />
  );
}
