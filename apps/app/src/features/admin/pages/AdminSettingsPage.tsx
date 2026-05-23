/**
 * /admin/settings — org-level admin controls.
 */
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { Button, Card } from "@/components/navigatr";
import { SeatUsageBadge } from "../components/SeatUsageBadge";
import { useOrganization } from "@/features/auth/useOrganization";

export function AdminSettingsPage() {
  const org = useOrganization();
  const inviteUrl = org.data ? `${window.location.origin}/signup?code=${org.data.inviteCode}` : "";

  const copyLink = async () => {
    await navigator.clipboard.writeText(inviteUrl);
    toast.success("Invite link copied");
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 flex flex-col gap-4">
      <h1 className="text-heading-lg">Settings</h1>

      <Card padding="md">
        <h2 className="text-body-strong">Organization</h2>
        <p className="mt-1 text-body-md text-text-muted">Name: {org.data?.name ?? "—"}</p>
      </Card>

      <Card padding="md">
        <h2 className="text-body-strong">Seat usage</h2>
        <div className="mt-2"><SeatUsageBadge /></div>
      </Card>

      <Card padding="md">
        <h2 className="text-body-strong">Shared invite link</h2>
        <p className="mt-1 text-body-md text-text-muted">
          Anyone with this link can join your org. For most agents, prefer the per-agent invites from the Team page.
        </p>
        <div className="mt-3 flex gap-2">
          <input value={inviteUrl} readOnly className="flex-1 rounded-radius-sm border border-border-default px-2 py-1 text-body-md" />
          <Button variant="secondary" size="md" leadingIcon={Copy} onClick={copyLink}>Copy</Button>
        </div>
      </Card>

      <Card padding="md">
        <h2 className="text-body-strong text-status-danger">Danger zone</h2>
        <div className="mt-3 flex flex-col gap-2">
          <Button variant="tertiary" size="md" onClick={() => toast("Transfer admin — lands in v1.1")}>Transfer admin</Button>
          <Button variant="tertiary" size="md" onClick={() => toast("Deactivate org — lands in v1.1")}>Deactivate org</Button>
        </div>
      </Card>
    </div>
  );
}
export default AdminSettingsPage;
