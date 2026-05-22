/**
 * AgentsPage — the admin's primary work surface. Lists every member of
 * the org (active + invited + revoked) with a row menu for each.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Plus, Upload } from "lucide-react";
import { Button } from "@/components/navigatr";
import { useOrgAgents, type AgentRow } from "../hooks/useOrgAgents";
import { useResendInvite } from "../hooks/useResendInvite";
import { useRevokeMember } from "../hooks/useRevokeMember";
import { AgentListRow } from "../components/AgentListRow";
import { SeatUsageBadge } from "../components/SeatUsageBadge";
import { InviteAgentModal } from "../components/InviteAgentModal";

export function AgentsPage() {
  const navigate = useNavigate();
  const [page, setPage] = React.useState(0);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const { data, isLoading } = useOrgAgents({ page });
  const resend = useResendInvite();
  const revoke = useRevokeMember();

  const handleResend = async (row: AgentRow) => {
    try {
      await resend.mutateAsync(row.id);
      toast.success(`Invite resent to ${row.email}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resend invite");
    }
  };

  const handleRevoke = async (row: AgentRow) => {
    const confirmed = window.confirm(
      row.status === "invited"
        ? `Revoke invite for ${row.email}?`
        : `Deactivate ${row.fullName ?? row.email}? Their deals stay attached and visible to you.`,
    );
    if (!confirmed) return;
    try {
      await revoke.mutateAsync({
        targetId: row.id,
        kind: row.kind === "invite" ? "invite" : "profile",
      });
      toast.success("Done.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not revoke");
    }
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-heading-lg text-text-default">Team</h1>
        <SeatUsageBadge />
      </header>

      <div className="mb-4 flex gap-2">
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
      </div>

      {isLoading ? (
        <p className="text-body-md text-text-muted">Loading…</p>
      ) : (
        <table className="w-full text-left">
          <thead className="border-b border-border-default text-eyebrow text-text-subtle">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Open deals</th>
              <th className="px-3 py-2 font-medium">Pipeline</th>
              <th className="px-3 py-2 font-medium" aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((row) => (
              <AgentListRow
                key={`${row.kind}:${row.id}`}
                row={row}
                onViewPipeline={() => navigate(`/pipeline?owner=${row.id}`)}
                onResend={handleResend}
                onRevoke={handleRevoke}
                onPromote={() => toast("Promote — coming in v1.1")}
              />
            ))}
          </tbody>
        </table>
      )}

      {/* Pager — only renders when there are more pages */}
      {(data?.totalCount ?? 0) > 50 && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-caption text-text-muted">
            Page {page + 1}
          </span>
          <div className="flex gap-2">
            <Button variant="tertiary" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button variant="tertiary" size="sm" onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      <InviteAgentModal open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}

export default AgentsPage;
