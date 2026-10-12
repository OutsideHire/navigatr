/**
 * PortalEraseData (NFR-PORT-09): when a partner relationship ends, an
 * administrator erases the partner's portal identity. Access is revoked, the
 * portal email and sign-in history (IP addresses) are erased, and the
 * partner's referrals stay. The server re-checks that the caller is an
 * administrator.
 */
import * as React from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/navigatr";
import { useProfile } from "@/features/auth/useProfile";
import { usePartnerPortalUser, usePurgePortalUser } from "../hooks/usePortalAccess";
import { portalAccessErrorMessage } from "../lib/portalAccess";

export function PortalEraseData({ partnerId, partnerName }: { partnerId: string; partnerName?: string }) {
  const profile = useProfile();
  const portalUser = usePartnerPortalUser(partnerId);
  const purge = usePurgePortalUser();
  const [confirming, setConfirming] = React.useState(false);

  if (profile.data?.role_level !== "administrator" || !portalUser.data) return null;
  const who = partnerName?.trim() || "this partner";

  const erase = async () => {
    try {
      await purge.mutateAsync(partnerId);
      toast.success("Portal data erased. Access is revoked.");
      setConfirming(false);
    } catch (err) {
      toast.error(portalAccessErrorMessage(err));
    }
  };

  if (!confirming) {
    return (
      <div className="pl-12">
        <Button variant="tertiary" size="sm" leadingIcon={Trash2} onClick={() => setConfirming(true)}>
          Erase portal data
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 pl-12">
      <p className="text-body-sm text-text-default">
        {`Erase ${who}'s portal sign-in details? Access is revoked right away and their portal email and sign-in history are erased. Their referrals stay.`}
      </p>
      <div className="flex gap-2">
        <Button variant="destructive" size="sm" loading={purge.isPending} onClick={() => void erase()}>
          Erase
        </Button>
        <Button variant="tertiary" size="sm" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export default PortalEraseData;
