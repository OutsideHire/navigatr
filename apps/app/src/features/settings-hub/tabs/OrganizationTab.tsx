/**
 * OrganizationTab — read-only-ish org metadata + shared invite link + seats.
 *
 * Reps see this tab with view-only fields (org name displayed, invite link
 * displayed). Managers and admins see the same content; the invite link is
 * the same for everyone (anyone with it can join). Admins additionally get a
 * "Regenerate" control that rotates the shared join code (invalidating the
 * old link) via the rotate_invite_code RPC.
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { Copy, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, Card } from "@/components/navigatr";
import { SeatUsageBadge } from "@/features/admin/components/SeatUsageBadge";
import { useRotateInviteCode } from "@/features/admin/hooks/useRotateInviteCode";
import { useOrganization } from "@/features/auth/useOrganization";
import { useProfile } from "@/features/auth/useProfile";
import { TabHeader } from "./TabHeader";

export function OrganizationTab() {
  const org = useOrganization();
  const profile = useProfile();
  // Manager-or-admin gates manager-visible data (seat usage, helper copy).
  const isManagerOrAdmin =
    profile.data?.role === "manager" || profile.data?.role === "admin";
  // Rotation locks out everyone holding the old link — admins only.
  const canRotate = profile.data?.role === "admin";
  const inviteUrl = org.data ? `${window.location.origin}/signup?code=${org.data.inviteCode}` : "";

  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const rotate = useRotateInviteCode();

  const copyLink = async () => {
    await navigator.clipboard.writeText(inviteUrl);
    toast.success("Invite link copied");
  };

  const handleRotate = async () => {
    try {
      await rotate.mutateAsync();
      toast.success("Invite link regenerated");
      setConfirmOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't regenerate the link. Try again.");
    }
  };

  return (
    <>
      <TabHeader
        title="Organization"
        subtitle={`Settings for ${org.data?.name ?? "your workspace"}.`}
      />
      <div className="flex flex-col gap-4">

      <Card padding="md">
        <h3 className="text-body-strong">Workspace</h3>
        <p className="mt-1 text-body-md text-text-muted">
          Name: {org.data?.name ?? "—"}
        </p>
      </Card>

      {isManagerOrAdmin && (
        // Seat usage is manager/admin-only data — reps don't need to see headcount.
        <Card padding="md">
          <h3 className="text-body-strong">Seat usage</h3>
          <div className="mt-2"><SeatUsageBadge /></div>
        </Card>
      )}

      <Card padding="md">
        <h3 className="text-body-strong">Shared invite link</h3>
        <p className="mt-1 text-body-md text-text-muted">
          Anyone with this link can join your org.
          {isManagerOrAdmin && " For most agents, prefer the per-agent invites from the Team page."}
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
          {canRotate && (
            <Button
              variant="tertiary"
              size="md"
              leadingIcon={RefreshCw}
              onClick={() => setConfirmOpen(true)}
            >
              Regenerate
            </Button>
          )}
        </div>
        {canRotate && (
          <p className="mt-2 text-caption text-text-muted">
            Regenerating breaks the current link — share the new one afterward.
          </p>
        )}
      </Card>
      </div>

      {canRotate && (
        <Dialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
            <Dialog.Content
              aria-describedby="rotate-dialog-desc"
              className={cn(
                "fixed z-50 flex flex-col bg-surface-default shadow-card-hover",
                "inset-x-0 bottom-0 max-h-[90dvh] rounded-t-radius-lg",
                "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-radius-lg",
              )}
            >
              <div className="flex items-center justify-between px-5 py-4">
                <Dialog.Title className="text-heading-sm">Regenerate invite link?</Dialog.Title>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    aria-label="Close"
                    className="h-8 w-8 rounded text-text-muted hover:bg-surface-sunken"
                  >
                    <X className="h-5 w-5 mx-auto" />
                  </button>
                </Dialog.Close>
              </div>

              <div className="flex flex-col gap-4 px-5 pb-5">
                <p id="rotate-dialog-desc" className="text-body-md text-text-default">
                  This breaks the current link. Anyone you&rsquo;ve already shared it with will
                  need the new one. Per-agent email invites are not affected.
                </p>

                <div className="mt-2 flex justify-end gap-2">
                  <Dialog.Close asChild>
                    <Button type="button" variant="tertiary" size="md">
                      Cancel
                    </Button>
                  </Dialog.Close>
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    loading={rotate.isPending}
                    disabled={rotate.isPending}
                    onClick={handleRotate}
                  >
                    Regenerate link
                  </Button>
                </div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </>
  );
}
