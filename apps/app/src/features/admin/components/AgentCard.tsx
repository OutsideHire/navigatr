/**
 * AgentCard — the mobile (`< md`) presentation of one AgentsPage agent.
 *
 * Renders the same agent data as AgentListRow, but stacked into a Card so the
 * 11-column leaderboard table doesn't have to horizontal-scroll on phones.
 * It reads the same LeaderboardRow and fires the same handlers (name navigate,
 * view pipeline / resend / revoke / promote) as the table row — only the
 * layout differs. Status + role badges sit under the name; the scan-critical
 * numbers (open deals, pipeline $, win rate) are shown as labeled stats.
 */
import { MoreHorizontal } from "lucide-react";
import { Badge, Card } from "@/components/navigatr";
import type { BadgeKind } from "@/components/navigatr/Badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { LeaderboardRow } from "../hooks/useTeamLeaderboard";
import { settableRoles, roleChangeLabel, type UserRole } from "../lib/roleActions";
import { formatMoney } from "@/features/pipeline/mockData";

const STATUS_BADGE: Record<LeaderboardRow["status"], { label: string; kind: BadgeKind }> = {
  active:  { label: "Active",  kind: "status-on-track" },
  invited: { label: "Invited", kind: "status-upcoming" },
  revoked: { label: "Revoked", kind: "priority-low" },
};

function winRateLabel(row: LeaderboardRow): string {
  const denom = row.won_deals_window + row.lost_deals_window;
  return denom === 0 ? "—" : `${Math.round((row.won_deals_window / denom) * 100)}%`;
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-eyebrow text-text-subtle">{label}</span>
      <span className="text-body-md tabular-nums text-text-default">{value}</span>
    </div>
  );
}

export function AgentCard({
  row,
  onNameClick,
  onViewPipeline,
  onResend,
  onRevoke,
  onSetRole,
  callerRole,
  selfId,
  activeAdminCount,
}: {
  row: LeaderboardRow;
  onNameClick: (row: LeaderboardRow) => void;
  onViewPipeline: (row: LeaderboardRow) => void;
  onResend: (row: LeaderboardRow) => void;
  onRevoke: (row: LeaderboardRow) => void;
  onSetRole: (row: LeaderboardRow, newRole: UserRole) => void;
  callerRole: UserRole | undefined;
  selfId: string | undefined;
  activeAdminCount: number;
}) {
  const status = STATUS_BADGE[row.status];
  return (
    <Card padding="md" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <button
            type="button"
            className="text-left text-body-md font-medium text-text-default hover:underline focus:outline-none"
            onClick={() => onNameClick(row)}
          >
            {row.full_name ?? "—"}
          </button>
          <span className="truncate text-body-sm text-text-muted">{row.email}</span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Row actions"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-radius-sm text-text-muted hover:bg-surface-sunken"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {row.status === "active" && (
              <DropdownMenuItem onSelect={() => onViewPipeline(row)}>
                View pipeline
              </DropdownMenuItem>
            )}
            {row.status === "invited" && (
              <DropdownMenuItem onSelect={() => onResend(row)}>
                Resend invite
              </DropdownMenuItem>
            )}
            {(row.status === "active" || row.status === "invited") && (
              <DropdownMenuItem onSelect={() => onRevoke(row)}>
                {row.status === "invited" ? "Revoke invite" : "Deactivate agent"}
              </DropdownMenuItem>
            )}
            {settableRoles(callerRole, { id: row.agent_id, role: row.role, status: row.status }, { selfId, activeAdminCount }).map((r) => (
              <DropdownMenuItem key={r} onSelect={() => onSetRole(row, r)}>
                {roleChangeLabel(row.role, r)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge kind={status.kind}>{status.label}</Badge>
        <Badge kind="priority-low" className="capitalize">{row.role}</Badge>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Open deals" value={row.open_deals} />
        <Stat label="Pipeline" value={formatMoney(row.pipeline_cents)} />
        <Stat label="Win rate" value={winRateLabel(row)} />
      </div>
    </Card>
  );
}

export default AgentCard;
