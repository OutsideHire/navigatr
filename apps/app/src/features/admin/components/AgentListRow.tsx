/**
 * AgentListRow — one row of the AgentsPage table. Status badge, name,
 * email, role, open deal count, pipeline value, overflow menu.
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
import type { AgentRow } from "../hooks/useOrgAgents";

const STATUS_BADGE: Record<AgentRow["status"], { label: string; kind: BadgeKind }> = {
  active:  { label: "Active",  kind: "status-on-track" },
  invited: { label: "Invited", kind: "status-upcoming" },
  revoked: { label: "Revoked", kind: "priority-low" },
};

function formatMoney(cents: number): string {
  if (cents >= 1_000_000_000) return `$${(cents / 100_000_000_000).toFixed(1)}B`;
  if (cents >= 100_000_000) return `$${Math.round(cents / 100_000_000)}M`;
  if (cents >= 100_000) return `$${Math.round(cents / 100_000)}K`;
  return `$${(cents / 100).toFixed(0)}`;
}

export function AgentListRow({
  row,
  onViewPipeline,
  onResend,
  onRevoke,
  onPromote,
}: {
  row: AgentRow;
  onViewPipeline: (row: AgentRow) => void;
  onResend: (row: AgentRow) => void;
  onRevoke: (row: AgentRow) => void;
  onPromote: (row: AgentRow) => void;
}) {
  const status = STATUS_BADGE[row.status];
  return (
    <tr className="border-b border-border-subtle">
      <td className="px-3 py-2 text-body-md">{row.fullName ?? "—"}</td>
      <td className="px-3 py-2 text-body-md text-text-muted">{row.email}</td>
      <td className="px-3 py-2"><Badge kind={status.kind}>{status.label}</Badge></td>
      <td className="px-3 py-2 text-body-md capitalize">{row.role}</td>
      <td className="px-3 py-2 text-body-md tabular-nums">{row.openDealCount}</td>
      <td className="px-3 py-2 text-body-md tabular-nums">{formatMoney(row.pipelineValueCents)}</td>
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
            {row.kind === "profile" && row.status === "active" && (
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
            {row.kind === "profile" && row.status === "active" && row.role === "rep" && (
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
