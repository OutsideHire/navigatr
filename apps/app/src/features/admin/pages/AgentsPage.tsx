/**
 * AgentsPage — the admin's primary work surface. Shows every team member
 * with sortable leaderboard columns and a window selector (7 / 30 / 90 days).
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ChevronUp, ChevronDown, ChevronsUpDown, Plus, Upload } from "lucide-react";
import { Button } from "@/components/navigatr";
import { useTeamLeaderboard, type LeaderboardRow } from "../hooks/useTeamLeaderboard";
import { useResendInvite } from "../hooks/useResendInvite";
import { useSendInviteEmails } from "../hooks/useSendInviteEmails";
import { useRevokeMember } from "../hooks/useRevokeMember";
import { useSetMemberRole } from "../hooks/useSetMemberRole";
import type { UserRole } from "../lib/roleActions";
import { hasNoReports } from "../lib/teamScope";
import { useAuth } from "@/stores/auth";
import { AgentListRow } from "../components/AgentListRow";
import { AgentCard } from "../components/AgentCard";
import { SeatUsageBadge } from "../components/SeatUsageBadge";
import { InviteAgentModal } from "../components/InviteAgentModal";
import { RevokeAgentDialog } from "../components/RevokeAgentDialog";
import { OrgChartTree } from "../components/OrgChartTree";
import { AppointmentsAwaitingCard } from "@/features/appointments/components/AppointmentsAwaitingCard";
import { LocationCaptureHealthCard } from "../components/LocationCaptureHealthCard";

type SortKey =
  | keyof Pick<
      LeaderboardRow,
      | "full_name"
      | "email"
      | "status"
      | "role"
      | "open_deals"
      | "pipeline_cents"
      | "won_cents_window"
      | "lost_cents_window"
      | "activities_window"
      | "last_activity"
    >
  | "win_rate";

type SortDir = "asc" | "desc";

const WINDOW_OPTIONS: { label: string; value: number }[] = [
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
];

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown className="ml-1 inline h-3 w-3 opacity-40" />;
  return sortDir === "asc"
    ? <ChevronUp className="ml-1 inline h-3 w-3" />
    : <ChevronDown className="ml-1 inline h-3 w-3" />;
}

function winRate(row: LeaderboardRow): number {
  const denom = row.won_deals_window + row.lost_deals_window;
  return denom === 0 ? -1 : row.won_deals_window / denom;
}

function sortRows(rows: LeaderboardRow[], key: SortKey, dir: SortDir): LeaderboardRow[] {
  return [...rows].sort((a, b) => {
    let cmp: number;
    if (key === "win_rate") {
      cmp = winRate(a) - winRate(b);
    } else {
      const av = a[key] ?? "";
      const bv = b[key] ?? "";
      if (typeof av === "number" && typeof bv === "number") {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv));
      }
    }
    return dir === "asc" ? cmp : -cmp;
  });
}

export function AgentsPage() {
  const navigate = useNavigate();
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [revokeDialogAgent, setRevokeDialogAgent] = React.useState<LeaderboardRow | null>(null);
  const [windowDays, setWindowDays] = React.useState<number>(30);
  const [sortKey, setSortKey] = React.useState<SortKey>("pipeline_cents");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");
  const [view, setView] = React.useState<"list" | "org">("list");

  const { data: rows = [], isLoading } = useTeamLeaderboard(windowDays);
  const resend = useResendInvite();
  const sendEmails = useSendInviteEmails();
  const revoke = useRevokeMember();
  const setRole = useSetMemberRole();

  const userId = useAuth((s) => s.user?.id);
  const soloTeam = !isLoading && hasNoReports(rows, userId);
  const callerRole = rows.find((r) => r.agent_id === userId)?.role as UserRole | undefined;
  const activeAdminCount = rows.filter((r) => r.role === "admin" && r.status === "active").length;

  const sorted = React.useMemo(
    () => sortRows(rows, sortKey, sortDir),
    [rows, sortKey, sortDir],
  );

  function handleSortClick(col: SortKey) {
    if (col === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col);
      setSortDir("desc");
    }
  }

  function thProps(col: SortKey) {
    return {
      className: "px-3 py-2 font-medium cursor-pointer select-none whitespace-nowrap",
      onClick: () => handleSortClick(col),
    };
  }

  const handleResend = async (row: LeaderboardRow) => {
    try {
      // admin_resend_invite refreshes the invite token/expiry and returns the
      // invite id; then we actually send the email (this second step was
      // previously missing, so "Resend" refreshed the link but sent nothing).
      const res = await resend.mutateAsync(row.agent_id);
      let emailOk = false;
      let emailErr = "";
      try {
        const emailResults = await sendEmails.mutateAsync([res.id]);
        const r = emailResults.find((e) => e.id === res.id);
        emailOk = Boolean(r?.ok);
        if (!emailOk) emailErr = r?.error ?? "the email service returned no result for this invite";
      } catch (e) {
        emailErr = e instanceof Error ? e.message : String(e);
      }
      if (emailOk) {
        toast.success(`Invite re-sent to ${res.email}`);
      } else {
        toast.warning(`Invite refreshed for ${res.email}, but email failed: ${emailErr}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resend invite");
    }
  };

  const handleRevoke = async (row: LeaderboardRow) => {
    if (row.status === "invited") {
      // Invites have no deals to reassign — keep as plain confirm.
      const confirmed = window.confirm(`Revoke invite for ${row.email}?`);
      if (!confirmed) return;
      try {
        await revoke.mutateAsync({ targetId: row.agent_id, kind: "invite" });
        toast.success("Done.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not revoke");
      }
    } else {
      // Active profile — open the dialog so deals can be reassigned first.
      setRevokeDialogAgent(row);
    }
  };

  const handleSetRole = (row: LeaderboardRow, newRole: UserRole) => {
    const who = row.full_name ?? row.email;
    const message =
      newRole === "admin"
        ? `Make ${who} an admin? This gives them full control of the organization, including billing and member management.`
        : `Change ${who}'s role to ${newRole}?`;
    if (!window.confirm(message)) return;
    setRole.mutate(
      { profileId: row.agent_id, newRole },
      {
        onSuccess: () => toast.success("Role updated"),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not change role"),
      },
    );
  };

  return (
    <div className="mx-auto w-full px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      {/* Single-row header: title + seat count chip (left), actions + window
          selector (right). Wraps on narrow viewports. Seat usage sits next to
          the title as a quiet chip rather than in the action cluster, since
          it is a secondary detail, not something reps act on. */}
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-heading-lg text-text-default">Team</h1>
          <SeatUsageBadge />
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="md"
            leadingIcon={Plus}
            onClick={() => setInviteOpen(true)}
          >
            Invite agent
          </Button>
          <Button
            variant="secondary"
            size="md"
            leadingIcon={Upload}
            onClick={() => navigate("/admin/agents/import")}
          >
            Import CSV
          </Button>
          <div className="ml-2 flex items-center gap-1 border-l border-border-subtle pl-2">
            <Button
              variant={view === "list" ? "secondary" : "tertiary"}
              size="sm"
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
            >
              List
            </Button>
            <Button
              variant={view === "org" ? "secondary" : "tertiary"}
              size="sm"
              aria-pressed={view === "org"}
              onClick={() => setView("org")}
            >
              Org chart
            </Button>
          </div>
          <div className="ml-2 flex items-center gap-1 border-l border-border-subtle pl-2">
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
          </div>
        </div>
      </header>

      {soloTeam && (
        <p className="text-body-sm text-text-muted" role="status">
          No one reports to you yet. As you assign reps to your team, they will appear here.
        </p>
      )}

      {isLoading ? (
        <p className="text-body-md text-text-muted">Loading…</p>
      ) : view === "org" ? (
        /* Org chart: the same leaderboard rows arranged by reporting line
           (manager_id → role_level). Selecting a person opens their detail. */
        <section aria-label="Org chart" className="overflow-x-auto">
          <OrgChartTree
            rows={rows}
            onSelect={(agentId) => navigate(`/admin/agents/${agentId}`)}
          />
        </section>
      ) : (
        <>
        {/* Desktop: the full leaderboard table. Cards take over below md so
            the 11-column table never has to horizontal-scroll on phones. */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left">
            <thead className="border-b border-border-default text-eyebrow text-text-subtle">
              <tr>
                <th {...thProps("full_name")}>
                  Name <SortIcon col="full_name" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th {...thProps("email")}>
                  Email <SortIcon col="email" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th {...thProps("status")}>
                  Status <SortIcon col="status" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th {...thProps("role")}>
                  Role <SortIcon col="role" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th {...thProps("open_deals")}>
                  Open deals <SortIcon col="open_deals" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th {...thProps("pipeline_cents")}>
                  Pipeline <SortIcon col="pipeline_cents" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th {...thProps("won_cents_window")}>
                  Won <SortIcon col="won_cents_window" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th {...thProps("lost_cents_window")}>
                  Lost <SortIcon col="lost_cents_window" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th {...thProps("win_rate")}>
                  Win rate <SortIcon col="win_rate" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th {...thProps("activities_window")}>
                  Activities <SortIcon col="activities_window" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th {...thProps("last_activity")}>
                  Last active <SortIcon col="last_activity" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th className="px-3 py-2 font-medium" aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <AgentListRow
                  key={row.agent_id}
                  row={row}
                  onNameClick={(r) => navigate(`/admin/agents/${r.agent_id}`)}
                  onViewPipeline={(r) => navigate(`/pipeline?owner=${r.agent_id}`)}
                  onResend={handleResend}
                  onRevoke={handleRevoke}
                  onSetRole={handleSetRole}
                  callerRole={callerRole}
                  selfId={userId}
                  activeAdminCount={activeAdminCount}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile: same agents, same order, stacked into cards. */}
        <div
          data-testid="agents-mobile-cards"
          className="flex flex-col gap-3 md:hidden"
        >
          {sorted.map((row) => (
            <AgentCard
              key={row.agent_id}
              row={row}
              onNameClick={(r) => navigate(`/admin/agents/${r.agent_id}`)}
              onViewPipeline={(r) => navigate(`/pipeline?owner=${r.agent_id}`)}
              onResend={handleResend}
              onRevoke={handleRevoke}
              onSetRole={handleSetRole}
              callerRole={callerRole}
              selfId={userId}
              activeAdminCount={activeAdminCount}
            />
          ))}
        </div>
        </>
      )}

      {/* Secondary insight: appointments awaiting an outcome, below the roster */}
      <AppointmentsAwaitingCard />

      {/* Operational: is location capture actually working during beta? (FR-HIER-37) */}
      <LocationCaptureHealthCard />

      <InviteAgentModal open={inviteOpen} onOpenChange={setInviteOpen} />

      {revokeDialogAgent && (
        <RevokeAgentDialog
          open={revokeDialogAgent !== null}
          onOpenChange={(o) => { if (!o) setRevokeDialogAgent(null); }}
          agent={revokeDialogAgent}
          activeAgents={rows.filter((r) => r.status === "active")}
        />
      )}
    </div>
  );
}

export default AgentsPage;
