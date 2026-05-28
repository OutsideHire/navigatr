/**
 * DangerZoneTab — org-level destructive actions. Admin only.
 *
 * Today: "Transfer admin" and "Deactivate org" are stubs that toast a
 * "lands in v1.1" message. The point of the tab is to claim the surface
 * so when those features land they have a home.
 *
 * Why a dedicated tab (not part of Organization): destructive actions
 * deserve a wall. Putting them on the same page as "invite teammates"
 * invites the wrong click.
 */
import { toast } from "sonner";
import { Button, Card } from "@/components/navigatr";

export function DangerZoneTab() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-heading-lg">Danger zone</h2>
      <Card padding="md">
        <h3 className="text-body-strong text-status-danger">Irreversible actions</h3>
        <p className="mt-1 text-body-md text-text-muted">
          These actions can't be undone. The buttons are stubs in v1.0 — full flows land in v1.1.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="tertiary"
            size="md"
            onClick={() => toast("Transfer admin — lands in v1.1")}
          >
            Transfer admin
          </Button>
          <Button
            variant="tertiary"
            size="md"
            onClick={() => toast("Deactivate org — lands in v1.1")}
          >
            Deactivate org
          </Button>
        </div>
      </Card>
    </div>
  );
}
