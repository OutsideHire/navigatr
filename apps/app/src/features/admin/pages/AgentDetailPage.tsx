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
import { Badge, Button, Card } from "@/components/navigatr";
import type { BadgeKind } from "@/components/navigatr/Badge";
import { useTeamLeaderboard } from "../hooks/useTeamLeaderboard";
import { useActivitiesForOrg } from "@/features/activities/hooks/useActivities";
import type { ActivityType } from "@/features/activities/mockData";
import { formatMoney, formatRelative } from "@/features/pipeline/mockData";

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
