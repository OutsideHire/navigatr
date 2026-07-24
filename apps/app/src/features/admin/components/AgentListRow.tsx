/**
 * AgentListRow — one row of the AgentsPage table. Status badge, name,
 * email, role, open deal count, pipeline value, won metrics, activities,
 * last active, and overflow menu.
 *
 * NOTE: The plan specified Badge kind values "success" | "info" | "muted"
 * which don't exist in the actual Badge component. Mapped to the closest
 * existing BadgeKind values:
 *   active  → "status-on-track"  (green)
 *   invited → "status-upcoming"  (blue/info)
 *   revoked → "priority-low"     (muted/gray)
 */
import { MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/navigatr";
import type { BadgeKind } from "@/components/navigatr/Badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { LeaderboardRow } from "../hooks/useTeamLeaderboard";
import { settableRoles, roleChangeLabel, type UserRole } from "../lib/roleActions";
import { formatMoney, formatRelative } from "@/features/pipeline/mockData";
import { cn } from "@/lib/utils";
import { isZeroMetric } from "../lib/metricDisplay";

const STATUS_BADGE: Record<LeaderboardRow["status"], { label: string; kind: BadgeKind }> = {
  active:  { label: "Active",  kind: "status-on-track" },
  invited: { label: "Invited", kind: "status-upcoming" },
  revoked: { label: "Revoked", kind: "priority-low" },
};

export function AgentListRow({
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
  const lastActive = row.last_activity ? formatRelative(row.last_activity) : "—";
  return (
    <tr className="border-b border-border-subtle">
      <td className="px-3 py-2 text-body-md">
        <button
          type="button"
          className="text-left text-text-default hover:underline focus:outline-none"
          onClick={() => onNameClick(row)}
        >
          {row.full_name ?? "—"}
        </button>
      </td>
      <td className="px-3 py-2 text-body-md text-text-muted">
        <span className="block max-w-[220px] truncate" title={row.email}>{row.email}</span>
      </td>
      <td className="px-3 py-2"><Badge kind={status.kind}>{status.label}</Badge></td>
      <td className="px-3 py-2 text-body-md capitalize">{row.role}</td>
      <td className={cn("px-3 py-2 text-body-md tabular-nums", isZeroMetric(row.open_deals) && "text-text-subtle")}>{row.open_deals}</td>
      <td className={cn("px-3 py-2 text-body-md tabular-nums", isZeroMetric(row.pipeline_cents) && "text-text-subtle")}>{formatMoney(row.pipeline_cents)}</td>
      <td className={cn("px-3 py-2 text-body-md tabular-nums", row.won_cents_window === 0 && row.won_deals_window === 0 && "text-text-subtle")}>
        {formatMoney(row.won_cents_window)}
        {(row.won_cents_window !== 0 || row.won_deals_window !== 0) && (
          <span className="text-text-muted"> ({row.won_deals_window})</span>
        )}
      </td>
      <td className={cn("px-3 py-2 text-body-md tabular-nums", row.lost_cents_window === 0 && row.lost_deals_window === 0 && "text-text-subtle")}>
        {formatMoney(row.lost_cents_window)}
        {(row.lost_cents_window !== 0 || row.lost_deals_window !== 0) && (
          <span className="text-text-muted"> ({row.lost_deals_window})</span>
        )}
      </td>
      <td className={cn("px-3 py-2 text-body-md tabular-nums", (row.won_deals_window + row.lost_deals_window) === 0 && "text-text-subtle")}>
        {(() => {
          const denom = row.won_deals_window + row.lost_deals_window;
          return denom === 0 ? "—" : `${Math.round((row.won_deals_window / denom) * 100)}%`;
        })()}
      </td>
      <td className={cn("px-3 py-2 text-body-md tabular-nums", isZeroMetric(row.activities_window) && "text-text-subtle")}>{row.activities_window}</td>
      <td className="px-3 py-2 text-body-md text-text-muted">{lastActive}</td>
      <td className="px-3 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Row actions"
              className="inline-flex h-8 w-8 items-center justify-center rounded-radius-sm text-text-muted hover:bg-surface-sunken"
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
      </td>
    </tr>
  );
}
