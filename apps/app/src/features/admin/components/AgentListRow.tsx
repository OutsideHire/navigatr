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
import { formatMoney, formatRelative } from "@/features/pipeline/mockData";

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
  onPromote,
}: {
  row: LeaderboardRow;
  onNameClick: (row: LeaderboardRow) => void;
  onViewPipeline: (row: LeaderboardRow) => void;
  onResend: (row: LeaderboardRow) => void;
  onRevoke: (row: LeaderboardRow) => void;
  onPromote: (row: LeaderboardRow) => void;
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
      <td className="px-3 py-2 text-body-md text-text-muted">{row.email}</td>
      <td className="px-3 py-2"><Badge kind={status.kind}>{status.label}</Badge></td>
      <td className="px-3 py-2 text-body-md capitalize">{row.role}</td>
      <td className="px-3 py-2 text-body-md tabular-nums">{row.open_deals}</td>
      <td className="px-3 py-2 text-body-md tabular-nums">{formatMoney(row.pipeline_cents)}</td>
      <td className="px-3 py-2 text-body-md tabular-nums">
        {formatMoney(row.won_cents_window)}{" "}
        <span className="text-text-muted">({row.won_deals_window})</span>
      </td>
      <td className="px-3 py-2 text-body-md tabular-nums">{row.activities_window}</td>
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
            {row.status === "active" && row.role === "rep" && (
              <DropdownMenuItem onSelect={() => onPromote(row)}>
                Promote to manager
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}
