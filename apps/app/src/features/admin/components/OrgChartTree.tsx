/**
 * OrgChartTree — an indented, expandable reporting-line tree for the Team page.
 *
 * Renders buildOrgTree(rows) as nested rows: each person shows their display
 * name (email fallback), a role-level label, and a small status hint for
 * invited/revoked members. Nodes with reports get an expand/collapse chevron
 * (default expanded). Clicking a person fires onSelect(agent_id) so the page
 * can open that agent's detail. Keyboard/AT-accessible: the chevron and the
 * name are real buttons, and the toggle carries aria-expanded.
 */
import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/navigatr";
import type { BadgeKind } from "@/components/navigatr/Badge";
import { cn } from "@/lib/utils";
import { ROLE_LEVEL_OPTIONS, type RoleLevel } from "@/features/auth/capabilities";
import type { LeaderboardRow } from "../hooks/useTeamLeaderboard";
import { buildOrgTree, type OrgTreeNode } from "../lib/orgTree";

const ROLE_LABEL: Record<RoleLevel, string> = ROLE_LEVEL_OPTIONS.reduce(
  (acc, o) => {
    acc[o.value] = o.label;
    return acc;
  },
  {} as Record<RoleLevel, string>,
);

function roleLabel(role: RoleLevel | null): string {
  return role == null ? "—" : (ROLE_LABEL[role] ?? "—");
}

const STATUS_HINT: Partial<Record<LeaderboardRow["status"], { label: string; kind: BadgeKind }>> = {
  invited: { label: "Invited", kind: "status-upcoming" },
  revoked: { label: "Revoked", kind: "priority-low" },
};

function TreeNode({
  node,
  collapsed,
  onToggle,
  onSelect,
}: {
  node: OrgTreeNode<LeaderboardRow>;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onSelect?: (agentId: string) => void;
}) {
  const { row, children, depth } = node;
  const hasChildren = children.length > 0;
  const isCollapsed = collapsed.has(row.agent_id);
  const hint = STATUS_HINT[row.status];
  const name = row.full_name ?? row.email;

  return (
    <li>
      <div
        className="flex items-center gap-2 rounded-radius-sm py-1.5 pr-2 hover:bg-surface-sunken"
        style={{ paddingLeft: `${depth * 20 + 4}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? `Expand ${name}` : `Collapse ${name}`}
            onClick={() => onToggle(row.agent_id)}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-radius-sm text-text-muted hover:bg-surface-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        ) : (
          <span className="inline-block h-5 w-5 shrink-0" aria-hidden="true" />
        )}

        <button
          type="button"
          onClick={() => onSelect?.(row.agent_id)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-radius-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
        >
          <span className="truncate text-body-md font-medium text-text-default hover:underline">
            {name}
          </span>
          <span className="shrink-0 text-body-sm text-text-muted">{roleLabel(row.role_level)}</span>
          {hint && (
            <Badge kind={hint.kind} className="shrink-0">
              {hint.label}
            </Badge>
          )}
        </button>
      </div>

      {hasChildren && !isCollapsed && (
        <ul className={cn("list-none")}>
          {children.map((child) => (
            <TreeNode
              key={child.row.agent_id}
              node={child}
              collapsed={collapsed}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function OrgChartTree({
  rows,
  onSelect,
}: {
  rows: LeaderboardRow[];
  onSelect?: (agentId: string) => void;
}) {
  const forest = React.useMemo(() => buildOrgTree(rows), [rows]);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());

  const handleToggle = React.useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (forest.length === 0) {
    return <p className="text-body-md text-text-muted">No team members to chart yet.</p>;
  }

  return (
    <ul className="list-none" aria-label="Reporting-line org chart">
      {forest.map((node) => (
        <TreeNode
          key={node.row.agent_id}
          node={node}
          collapsed={collapsed}
          onToggle={handleToggle}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

export default OrgChartTree;
