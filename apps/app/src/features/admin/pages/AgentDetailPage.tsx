/**
 * AgentDetailPage — per-agent detail view at /admin/agents/:id.
 *
 * Composes from two existing data sources without new RPCs:
 *   - useTeamLeaderboard: agent rollup (open deals, pipeline, won, activities)
 *   - useActivitiesForOrg: org-wide activities, filtered client-side by loggedBy
 */
import * as React from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Phone, Mail, MapPin, Calendar, Loader2 } from "lucide-react";
import { Badge, Button, Card, Select } from "@/components/navigatr";
import type { BadgeKind } from "@/components/navigatr/Badge";
import { useTeamLeaderboard } from "../hooks/useTeamLeaderboard";
import { useSetMemberManager } from "../hooks/useSetMemberManager";
import { useActivitiesForOrg } from "@/features/activities/hooks/useActivities";
import { useAuth } from "@/stores/auth";
import type { ActivityType } from "@/features/activities/mockData";
import { formatMoney, formatRelative } from "@/features/pipeline/mockData";
import { toast } from "sonner";

// Radix Select forbids empty-string item values (it reserves "" to clear the
// selection), so "No manager" uses this sentinel and maps back to null on
// change — mirrors the codebase's existing "none" pattern (partnerForm cadence).
const NO_MANAGER = "none";

// Friendly copy for admin_set_manager RPC error codes (raw Postgres exception
// messages should never reach the toast).
const MANAGER_ERROR_COPY: Record<string, string> = {
  cycle_detected: "That would create a reporting loop.",
  cannot_report_to_self: "Someone can't report to themselves.",
  cannot_place_admin: "Admins aren't placed in the reporting chart.",
  manager_not_found: "That manager is no longer available.",
  member_not_found: "That member is no longer available.",
  forbidden: "Only an admin can change reporting.",
};

const WINDOW_OPTIONS: { label: string; value: number }[] = [
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
];

const STATUS_BADGE: Record<string, { label: string; kind: BadgeKind }> = {
  active:  { label: "Active",  kind: "status-on-track" },
  invited: { label: "Invited", kind: "status-upcoming" },
  revoked: { label: "Revoked", kind: "priority-low" },
};

const ACTIVITY_TYPE_CONFIG: Record<
  ActivityType,
  { label: string; Icon: React.FC<React.SVGProps<SVGSVGElement>> }
> = {
  call:        { label: "Calls",        Icon: Phone },
  email:       { label: "Emails",       Icon: Mail },
  drop_in:     { label: "Drop-ins",     Icon: MapPin },
  appointment: { label: "Appointments", Icon: Calendar },
};

export function AgentDetailPage() {
  const { id: agentId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [windowDays, setWindowDays] = React.useState<number>(30);

  const { data: leaderboardRows = [], isLoading: leaderboardLoading } =
    useTeamLeaderboard(windowDays);
  const { data: allActivities = [], isLoading: activitiesLoading } =
    useActivitiesForOrg();

  const isLoading = leaderboardLoading || activitiesLoading;

  const agent = React.useMemo(
    () => leaderboardRows.find((r) => r.agent_id === agentId),
    [leaderboardRows, agentId],
  );

  // Activities logged by this agent within the selected window.
  const cutoff = React.useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - windowDays);
    return d.toISOString();
  }, [windowDays]);

  const agentActivities = React.useMemo(
    () =>
      allActivities.filter(
        (a) => a.loggedBy != null && a.loggedBy === agentId && a.occurredAt >= cutoff,
      ),
    [allActivities, agentId, cutoff],
  );

  const breakdown = React.useMemo(() => {
    const counts: Record<ActivityType, number> = {
      call: 0,
      email: 0,
      drop_in: 0,
      appointment: 0,
    };
    for (const a of agentActivities) {
      counts[a.type] = (counts[a.type] ?? 0) + 1;
    }
    return counts;
  }, [agentActivities]);

  const recentActivities = React.useMemo(
    () =>
      [...agentActivities]
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
        .slice(0, 10),
    [agentActivities],
  );

  const setManager = useSetMemberManager();
  const userId = useAuth((s) => s.user?.id);
  const callerRole = React.useMemo(
    () => leaderboardRows.find((r) => r.agent_id === userId)?.role,
    [leaderboardRows, userId],
  );
  // The agent's transitive reports — excluded as "reports to" targets so the
  // picker can't create a reporting loop (the server guards this too).
  const descendantIds = React.useMemo(() => {
    const childrenByManager = new Map<string, string[]>();
    for (const r of leaderboardRows) {
      if (r.manager_id) {
        const arr = childrenByManager.get(r.manager_id) ?? [];
        arr.push(r.agent_id);
        childrenByManager.set(r.manager_id, arr);
      }
    }
    const out = new Set<string>();
    const stack = [...(childrenByManager.get(agentId ?? "") ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      if (out.has(id)) continue;
      out.add(id);
      for (const c of childrenByManager.get(id) ?? []) stack.push(c);
    }
    return out;
  }, [leaderboardRows, agentId]);

  // Eligible "reports to" targets: active managers/admins, not the agent, not
  // in the agent's own subtree. Plus the currently-assigned manager even if now
  // ineligible (deactivated / demoted), so the current line is never silently
  // blank.
  const managerOptions = React.useMemo(() => {
    const opts = leaderboardRows
      .filter(
        (r) =>
          r.status === "active" &&
          (r.role === "manager" || r.role === "admin") &&
          r.agent_id !== agentId &&
          !descendantIds.has(r.agent_id),
      )
      .map((r) => ({ value: r.agent_id, label: r.full_name ?? r.email }));
    if (agent?.manager_id && !opts.some((o) => o.value === agent.manager_id)) {
      const current = leaderboardRows.find((r) => r.agent_id === agent.manager_id);
      if (current) {
        opts.unshift({
          value: current.agent_id,
          label: `${current.full_name ?? current.email}${current.status !== "active" ? " (inactive)" : ""}`,
        });
      }
    }
    return opts;
  }, [leaderboardRows, agentId, descendantIds, agent?.manager_id]);

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-label="Loading…" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="mx-auto w-full px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-body-md text-text-muted">Agent not found.</p>
        <Link to="/admin/agents" className="mt-2 inline-block text-body-md text-text-default underline">
          Back to team
        </Link>
      </div>
    );
  }

  const statusBadge = STATUS_BADGE[agent.status] ?? STATUS_BADGE.active;

  return (
    <div className="mx-auto w-full px-4 py-6 sm:px-6 lg:px-8 flex flex-col gap-4">
      {/* Back link — small, inline above the header */}
      <button
        type="button"
        className="inline-flex w-fit items-center gap-1 text-caption text-text-muted hover:text-text-default"
        onClick={() => navigate("/admin/agents")}
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to team
      </button>

      {/* Header row — name + status on left, View pipeline CTA on right */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-heading-lg text-text-default">
              {agent.full_name ?? agent.email}
            </h1>
            <Badge kind={statusBadge.kind}>{statusBadge.label}</Badge>
          </div>
          <p className="text-body-md text-text-muted">
            {agent.email} · {agent.role}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {WINDOW_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={windowDays === opt.value ? "secondary" : "tertiary"}
              size="sm"
              onClick={() => setWindowDays(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
          <Button
            variant="primary"
            size="md"
            onClick={() => navigate(`/pipeline?owner=${agentId}`)}
          >
            View their pipeline →
          </Button>
        </div>
      </div>

      {/* Reporting line — who this person reports to (activates hierarchy scoping) */}
      <Card padding="md">
        <p className="text-eyebrow text-text-subtle uppercase tracking-wider">Reports to</p>
        {agent.role === "admin" ? (
          <p className="mt-1 text-body-md text-text-muted">
            Admins see the whole organization.
          </p>
        ) : callerRole === "admin" && agent.status === "active" ? (
          <div className="mt-1 max-w-xs">
            <Select
              id="agent-manager"
              value={agent.manager_id ?? NO_MANAGER}
              onValueChange={(v) => {
                setManager.mutate(
                  { memberId: agentId!, managerId: v === NO_MANAGER ? null : v },
                  {
                    onSuccess: () => toast.success("Reporting updated"),
                    onError: (e) =>
                      toast.error(
                        (e instanceof Error && MANAGER_ERROR_COPY[e.message]) ||
                          "Could not update reporting",
                      ),
                  },
                );
              }}
              options={[{ value: NO_MANAGER, label: "No manager" }, ...managerOptions]}
            />
          </div>
        ) : (
          <p className="mt-1 text-body-md text-text-default">
            {(() => {
              const m = leaderboardRows.find((r) => r.agent_id === agent.manager_id);
              return m ? (m.full_name ?? m.email) : "No manager";
            })()}
          </p>
        )}
      </Card>

      {/* KPI row — 6 cards: Open Deals / Pipeline / Won / Lost / Win rate / Activities */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card padding="md">
          <p className="text-eyebrow text-text-subtle uppercase tracking-wider">Open Deals</p>
          <p className="mt-1 text-heading-lg tabular-nums">{agent.open_deals}</p>
        </Card>
        <Card padding="md">
          <p className="text-eyebrow text-text-subtle uppercase tracking-wider">Pipeline</p>
          <p className="mt-1 text-heading-lg tabular-nums">{formatMoney(agent.pipeline_cents)}</p>
        </Card>
        <Card padding="md">
          <p className="text-eyebrow text-text-subtle uppercase tracking-wider">Won ({windowDays}d)</p>
          <p className="mt-1 text-heading-lg tabular-nums">
            {formatMoney(agent.won_cents_window)}{" "}
            <span className="text-body-md text-text-muted">({agent.won_deals_window})</span>
          </p>
        </Card>
        <Card padding="md">
          <p className="text-eyebrow text-text-subtle uppercase tracking-wider">Lost ({windowDays}d)</p>
          <p className="mt-1 text-heading-lg tabular-nums">
            {formatMoney(agent.lost_cents_window)}{" "}
            <span className="text-body-md text-text-muted">({agent.lost_deals_window})</span>
          </p>
        </Card>
        <Card padding="md">
          <p className="text-eyebrow text-text-subtle uppercase tracking-wider">Win Rate ({windowDays}d)</p>
          <p className="mt-1 text-heading-lg tabular-nums">
            {(() => {
              const denom = agent.won_deals_window + agent.lost_deals_window;
              return denom === 0 ? "—" : `${Math.round((agent.won_deals_window / denom) * 100)}%`;
            })()}
          </p>
        </Card>
        <Card padding="md">
          <p className="text-eyebrow text-text-subtle uppercase tracking-wider">Activities</p>
          <p className="mt-1 text-heading-lg tabular-nums">{agent.activities_window}</p>
        </Card>
      </div>

      {/* Activity breakdown + Recent activity — side-by-side on lg+, stacked below.
          Breakdown is short (4 fixed rows); Recent is the longer list. lg:grid-cols-3
          gives the wider Recent column 2/3 of the row — matches the relative
          content density. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card padding="md" className="lg:col-span-1">
          <h2 className="text-body-strong">Activity breakdown ({windowDays} days)</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {(["call", "email", "drop_in", "appointment"] as ActivityType[]).map((type) => {
              const { label, Icon } = ACTIVITY_TYPE_CONFIG[type];
              return (
                <li key={type} className="flex items-center gap-2 text-body-md">
                  <Icon className="h-4 w-4 text-text-subtle" />
                  <span className="flex-1 text-text-default">{label}</span>
                  <span className="tabular-nums text-text-default">{breakdown[type]}</span>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card padding="md" className="lg:col-span-2">
          <h2 className="text-body-strong">Recent activity</h2>
          {recentActivities.length === 0 ? (
            <p className="mt-2 text-body-md text-text-muted">No activities in this window.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {recentActivities.map((a) => {
                const { label, Icon } = ACTIVITY_TYPE_CONFIG[a.type];
                return (
                  <li key={a.id} className="flex items-start gap-2 text-body-md">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-text-subtle" />
                    <div className="flex-1 min-w-0">
                      <span className="text-text-default">{label}</span>
                      {" · "}
                      <span className="text-text-muted capitalize">
                        {a.disposition.replace(/_/g, " ")}
                      </span>
                      {" · "}
                      <span className="text-text-muted">{formatRelative(a.occurredAt)}</span>
                      {a.outcomeNotes && (
                        <p className="mt-0.5 truncate text-text-subtle">{a.outcomeNotes}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

export default AgentDetailPage;
