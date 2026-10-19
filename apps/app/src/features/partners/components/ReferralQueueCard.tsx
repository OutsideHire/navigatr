/**
 * ReferralQueueCard: partner referrals and public form submissions waiting for
 * triage, oldest first. Hidden when there are none, so it costs no space on a
 * normal day. On Partner Detail it is filtered to that partner, and form
 * submissions (no partner yet) are left out. An open review sheet stays mounted
 * even if the queue empties under it (an attribution refetch), so it never
 * vanishes mid-flow. The card holds the selected item (a snapshot taken on
 * click), not one re-derived from the live queue.
 */
import * as React from "react";
import { Card, Button } from "@/components/navigatr";
import { useAuth } from "@/stores/auth";
import { useReferralQueue, type QueueReferral } from "../hooks/useReferralQueue";
import { useFormSubmissionQueue, type QueueSubmission } from "../hooks/useFormSubmissionQueue";
import { formSubmissionSourceLabel } from "../lib/referrals";
import { ReviewReferralSheet } from "./ReviewReferralSheet";
import { ReviewFormSubmissionSheet } from "./ReviewFormSubmissionSheet";

type QueueItem =
  | { kind: "referral"; key: string; at: number; item: QueueReferral }
  | { kind: "submission"; key: string; at: number; item: QueueSubmission };

export function ReferralQueueCard({ partnerId }: { partnerId?: string }) {
  const { data } = useReferralQueue();
  const { data: submissions } = useFormSubmissionQueue();
  const viewerId = useAuth((s) => s.user?.id);
  const [active, setActive] = React.useState<QueueReferral | null>(null);
  const [activeSubmission, setActiveSubmission] = React.useState<QueueSubmission | null>(null);

  const items = React.useMemo<QueueItem[]>(() => {
    const referrals: QueueItem[] = (data ?? [])
      .filter((r) => !partnerId || r.partnerId === partnerId)
      .map((r) => ({ kind: "referral" as const, key: `r:${r.id}`, at: Date.parse(r.submittedAt), item: r }));
    const forms: QueueItem[] = partnerId
      ? []
      : (submissions ?? []).map((s) => ({ kind: "submission" as const, key: `s:${s.id}`, at: Date.parse(s.submittedAt), item: s }));
    // Stable sort: on a tie a referral stays ahead of a submission.
    return [...referrals, ...forms].sort((a, b) => a.at - b.at);
  }, [data, submissions, partnerId]);

  const sheets = (
    <>
      <ReviewReferralSheet
        referral={active}
        open={active !== null}
        onOpenChange={(o) => { if (!o) setActive(null); }}
      />
      <ReviewFormSubmissionSheet
        submission={activeSubmission}
        open={activeSubmission !== null}
        onOpenChange={(o) => { if (!o) setActiveSubmission(null); }}
      />
    </>
  );

  if (items.length === 0) return active || activeSubmission ? sheets : null;

  return (
    <Card padding="md">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-body-strong text-text-default">Referrals to review</h3>
        <span className="rounded-full bg-status-warning-bg px-2 text-caption font-medium tabular-nums text-status-warning">
          {items.length}
        </span>
      </div>
      <ul className="flex flex-col divide-y divide-border-subtle">
        {items.map((q) => (
          <li key={q.key} className="flex items-center justify-between gap-3 py-2">
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-body-md text-text-default">{q.item.companyName}</span>
              <span className="truncate text-caption text-text-muted">
                {q.kind === "referral"
                  ? `From ${q.item.partnerName}`
                  : formSubmissionSourceLabel(q.item.linkType, q.item.assignedUserId === viewerId)}
              </span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              aria-label={`Review ${q.item.companyName}`}
              onClick={() => {
                if (q.kind === "referral") setActive(q.item);
                else setActiveSubmission(q.item);
              }}
            >
              Review
            </Button>
          </li>
        ))}
      </ul>
      {sheets}
    </Card>
  );
}

export default ReferralQueueCard;
