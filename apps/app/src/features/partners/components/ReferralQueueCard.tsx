/**
 * ReferralQueueCard: referrals waiting for triage. Hidden when there are none,
 * so it costs no space on a normal day. On Partner Detail it is filtered to
 * that partner.
 */
import * as React from "react";
import { Card, Button } from "@/components/navigatr";
import { useReferralQueue, type QueueReferral } from "../hooks/useReferralQueue";
import { ReviewReferralSheet } from "./ReviewReferralSheet";

export function ReferralQueueCard({ partnerId }: { partnerId?: string }) {
  const { data } = useReferralQueue();
  const [active, setActive] = React.useState<QueueReferral | null>(null);

  const items = React.useMemo(
    () => (data ?? []).filter((r) => !partnerId || r.partnerId === partnerId),
    [data, partnerId],
  );
  if (items.length === 0) return null;

  return (
    <Card padding="md">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-body-strong text-text-default">Referrals to review</h3>
        <span className="rounded-full bg-status-warning-bg px-2 text-caption font-medium tabular-nums text-status-warning">
          {items.length}
        </span>
      </div>
      <ul className="flex flex-col divide-y divide-border-subtle">
        {items.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 py-2">
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-body-md text-text-default">{r.companyName}</span>
              <span className="truncate text-caption text-text-muted">From {r.partnerName}</span>
            </div>
            <Button variant="secondary" size="sm" aria-label={`Review ${r.companyName}`} onClick={() => setActive(r)}>
              Review
            </Button>
          </li>
        ))}
      </ul>
      <ReviewReferralSheet
        referral={active}
        open={active !== null}
        onOpenChange={(o) => { if (!o) setActive(null); }}
      />
    </Card>
  );
}

export default ReferralQueueCard;
