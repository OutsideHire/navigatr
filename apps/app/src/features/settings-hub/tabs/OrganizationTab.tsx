/**
 * OrganizationTab — read-only-ish org metadata + shared invite link + seats.
 *
 * Reps see this tab with view-only fields (org name displayed, invite link
 * displayed). Managers and admins see the same content; the invite link is
 * the same for everyone (anyone with it can join).
 */
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { Button, Card } from "@/components/navigatr";
import { SeatUsageBadge } from "@/features/admin/components/SeatUsageBadge";
import { useOrganization } from "@/features/auth/useOrganization";
import { useProfile } from "@/features/auth/useProfile";

export function OrganizationTab() {
  const org = useOrganization();
  const profile = useProfile();
  const isAdmin = profile.data?.role === "manager" || profile.data?.role === "admin";
  const inviteUrl = org.data ? `${window.location.origin}/signup?code=${org.data.inviteCode}` : "";

  const copyLink = async () => {
    await navigator.clipboard.writeText(inviteUrl);
    toast.success("Invite link copied");
  };

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-heading-lg">Organization</h2>

      <Card padding="md">
        <h3 className="text-body-strong">Workspace</h3>
        <p className="mt-1 text-body-md text-text-muted">
          Name: {org.data?.name ?? "—"}
        </p>
      </Card>

      {isAdmin && (
        // Seat usage is admin-only data — reps don't need to see headcount.
        <Card padding="md">
          <h3 className="text-body-strong">Seat usage</h3>
          <div className="mt-2"><SeatUsageBadge /></div>
        </Card>
      )}

      <Card padding="md">
        <h3 className="text-body-strong">Shared invite link</h3>
        <p className="mt-1 text-body-md text-text-muted">
          Anyone with this link can join your org.
          {isAdmin && " For most agents, prefer the per-agent invites from the Team page."}
        </p>
        <div className="mt-3 flex gap-2">
          <input
            value={inviteUrl}
            readOnly
            aria-label="Shared invite link"
            className="flex-1 rounded-radius-sm border border-border-default px-2 py-1 text-body-md"
          />
          <Button variant="secondary" size="md" leadingIcon={Copy} onClick={copyLink}>
            Copy
          </Button>
        </div>
      </Card>
    </div>
  );
}
