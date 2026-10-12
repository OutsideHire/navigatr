/**
 * ReinstatableReferralsCard: referrals from this partner that were declined as
 * duplicates of an earlier referral that has since closed (FR-PORT-48). One
 * tap puts each back in Referrals to review. Hidden when there are none.
 */
import * as React from "react";
import { toast } from "sonner";
import { Button, Card } from "@/components/navigatr";
import { useReinstatableReferrals, useReinstateReferral } from "../hooks/useReinstateReferral";

export function ReinstatableReferralsCard({ partnerId }: { partnerId: string }) {
  const { data } = useReinstatableReferrals(partnerId);
  const reinstate = useReinstateReferral();
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const items = data ?? [];
  if (items.length === 0) return null;

  const onReinstate = async (id: string) => {
    setBusyId(id);
    try {
      await reinstate.mutateAsync(id);
      toast.success("Reinstated. It's back in Referrals to review.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't reinstate the referral");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card padding="md">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-body-strong text-text-default">Declined duplicates you can reinstate</h3>
        <span className="rounded-full bg-surface-sunken px-2 text-caption font-medium tabular-nums text-text-muted">
          {items.length}
        </span>
      </div>
      <p className="mb-3 text-caption text-text-muted">The earlier referral for each of these is now closed.</p>
      <ul className="flex flex-col divide-y divide-border-subtle">
        {items.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0 truncate text-body-md text-text-default">{r.companyName}</span>
            <Button
              variant="secondary"
              size="sm"
              aria-label={`Reinstate ${r.companyName}`}
              loading={busyId === r.id}
              disabled={busyId !== null}
              onClick={() => void onReinstate(r.id)}
            >
              Reinstate
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default ReinstatableReferralsCard;
