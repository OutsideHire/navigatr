// apps/app/src/features/partners/components/ReviewReferralSheet.tsx
/**
 * ReviewReferralSheet: triage one submitted referral. Accept creates the deal
 * (lead source Partner referral, first follow-up task); Decline needs a reason;
 * Merge links it to a deal the rep can already see and leaves that deal's lead
 * source alone. Same Radix Dialog shell as SendReferralSheet.
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button, Select, NotesFieldWithMic } from "@/components/navigatr";
import { usePlaceDuplicateCheck } from "@/features/pipeline/hooks/usePlaceDuplicateCheck";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import type { QueueReferral } from "../hooks/useReferralQueue";
import { useAcceptReferral, useDeclineReferral, useMergeReferral } from "../hooks/useReferralMutations";
import { DECLINE_REASON_OPTIONS, type DeclineReason } from "../lib/referrals";

type Mode = "main" | "decline" | "merge";

export interface ReviewReferralSheetProps {
  referral: QueueReferral | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ReviewReferralSheet({ referral, open, onOpenChange }: ReviewReferralSheetProps) {
  const accept = useAcceptReferral();
  const decline = useDeclineReferral();
  const merge = useMergeReferral();
  const { checkPlaceDuplicate } = usePlaceDuplicateCheck();
  const { data: deals = [] } = useDeals();

  const [mode, setMode] = React.useState<Mode>("main");
  const [reason, setReason] = React.useState<DeclineReason | "">("");
  const [note, setNote] = React.useState("");
  const [mergeDealId, setMergeDealId] = React.useState("");
  const [dupName, setDupName] = React.useState<string | null>(null);

  React.useEffect(() => {
    setMode("main");
    setReason("");
    setNote("");
    setMergeDealId("");
    setDupName(null);
    if (!open || !referral) return;
    let live = true;
    void checkPlaceDuplicate({
      placeId: referral.placeId,
      name: referral.companyName,
      phone: referral.contactPhone,
      address: referral.address,
    }).then((m) => { if (live) setDupName(m?.companyName ?? null); });
    return () => { live = false; };
  }, [open, referral, checkPlaceDuplicate]);

  const openDeals = React.useMemo(
    () => deals
      .filter((d) => d.stage !== "won" && d.stage !== "lost")
      .sort((a, b) => a.companyName.localeCompare(b.companyName))
      .map((d) => ({ value: d.id, label: d.companyName })),
    [deals],
  );

  if (!referral) return null;

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  const onAccept = () => run(async () => {
    const res = await accept.mutateAsync(referral.id);
    if (res.result === "accepted") {
      toast.success("Accepted. Deal created.");
      onOpenChange(false);
      return;
    }
    toast.error("Already in your team's pipeline");
    setMergeDealId(res.dealId ?? "");
    setMode("merge");
  });

  const onDecline = () => run(async () => {
    if (!reason) return;
    await decline.mutateAsync({ referralId: referral.id, reason, note });
    toast.success("Referral declined");
    onOpenChange(false);
  });

  const onMerge = () => run(async () => {
    if (!mergeDealId) return;
    await merge.mutateAsync({ referralId: referral.id, dealId: mergeDealId });
    toast.success("Merged into the existing deal");
    onOpenChange(false);
  });

  const submitted = new Date(referral.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const details: Array<[string, string | null]> = [
    ["Contact", referral.contactName],
    ["Phone", referral.contactPhone],
    ["Email", referral.contactEmail],
    ["Address", referral.address],
  ];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[90dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-radius-lg bg-surface-default p-5 shadow-card-hover sm:inset-0 sm:bottom-auto sm:top-1/2 sm:max-h-[85dvh] sm:-translate-y-1/2 sm:rounded-radius-lg"
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-heading-sm text-text-default">Review referral</Dialog.Title>
            <Dialog.Close asChild>
              <button aria-label="Close" className="rounded-radius-sm p-1 text-text-muted hover:text-text-default">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-body-strong text-text-default">{referral.companyName}</span>
            <span className="text-caption text-text-muted">
              From {referral.partnerName} · {referral.partnerCompany} · {submitted}
            </span>
          </div>

          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
            {details.filter(([, v]) => v).map(([k, v]) => (
              <React.Fragment key={k}>
                <dt className="text-caption text-text-subtle">{k}</dt>
                <dd className="text-body-md text-text-default">{v}</dd>
              </React.Fragment>
            ))}
          </dl>

          {referral.notes && (
            <p className="whitespace-pre-wrap text-body-md text-text-muted">{referral.notes}</p>
          )}

          {dupName && (
            <p className="rounded-radius-sm bg-status-warning-bg p-3 text-body-sm text-status-warning">
              Possible duplicate: {dupName} is already in your team's pipeline.
            </p>
          )}

          {mode === "main" && (
            <div className="flex flex-col gap-2 pt-1">
              <Button variant="primary" loading={accept.isPending} disabled={accept.isPending} onClick={onAccept}>
                Accept
              </Button>
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setMode("merge")}>Merge</Button>
                <Button variant="secondary" className="flex-1" onClick={() => setMode("decline")}>Decline</Button>
              </div>
            </div>
          )}

          {mode === "decline" && (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-caption font-medium text-text-muted">Reason</span>
                <Select
                  value={reason}
                  onValueChange={(v) => setReason(v as DeclineReason)}
                  placeholder="Pick a reason…"
                  options={DECLINE_REASON_OPTIONS}
                />
              </label>
              <NotesFieldWithMic value={note} onChange={setNote} placeholder="Internal note (optional)" />
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setMode("main")}>Back</Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  disabled={!reason || decline.isPending}
                  loading={decline.isPending}
                  onClick={onDecline}
                >
                  Decline referral
                </Button>
              </div>
            </div>
          )}

          {mode === "merge" && (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-caption font-medium text-text-muted">Existing deal</span>
                <Select
                  value={mergeDealId}
                  onValueChange={setMergeDealId}
                  placeholder="Pick a deal…"
                  options={openDeals}
                />
              </label>
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setMode("main")}>Back</Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  disabled={!mergeDealId || merge.isPending}
                  loading={merge.isPending}
                  onClick={onMerge}
                >
                  Merge into deal
                </Button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default ReviewReferralSheet;
