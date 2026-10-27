// apps/app/src/features/partners/components/ReviewReferralSheet.tsx
/**
 * ReviewReferralSheet: triage one submitted referral. Accept creates the deal
 * (lead source Partner referral, first follow-up task); Decline needs a reason
 * (internal, like its note) and takes an optional message the partner sees
 * (FR-PORT-65); Merge links it to a deal the rep can already see and leaves that deal's lead
 * source alone. Same Radix Dialog shell as SendReferralSheet.
 *
 * Phase 1B: a referral sent through the partner portal says so, and one the
 * portal flagged as a probable duplicate arrives with Decline (duplicate)
 * preselected. Accepting it anyway needs a short written reason, which lands in
 * the referral's history (FR-PORT-47). Merging it needs a reason too; when the
 * deal already credits another partner, that partner keeps the credit and this
 * referral closes as a duplicate. The urgency the partner picked shows with the
 * details.
 *
 * A business that is already a won customer the rep can see gets an "Already a
 * customer" line linking to the deal (FR-PORT-44). Reps only, never the partner.
 *
 * Phase 2A: a business that looks like a chain gets an advisory line
 * (FR-PORT-58); it never blocks anything. Managers and administrators can
 * reassign the referral to a teammate they can see, and are warned BEFORE
 * confirming when that teammate cannot see the partner (FR-PORT-55).
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Button, Select, NotesFieldWithMic } from "@/components/navigatr";
import { useProfile } from "@/features/auth/useProfile";
import { usePlaceDuplicateCheck } from "@/features/pipeline/hooks/usePlaceDuplicateCheck";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import { useCustomerMatch } from "../hooks/useCustomerMatch";
import type { QueueReferral } from "../hooks/useReferralQueue";
import { useAcceptReferral, useDeclineReferral, useMergeReferral } from "../hooks/useReferralMutations";
import { REFERRAL_UPDATE_MAX } from "../hooks/useReferralUpdates";
import { WithdrawReferralConfirm } from "./WithdrawReferralConfirm";
import { ReferralHistory } from "./ReferralHistory";
import { useAssigneeSeesPartner, useReassignReferral, useReferralAssignees } from "../hooks/useReassignReferral";
import { DECLINE_REASON_OPTIONS, canReassignReferrals, icpFlagLabels, mergeResultMessage, type DeclineReason } from "../lib/referrals";
import { urgencyLabel } from "../../../../../../supabase/functions/_shared/portalSubmission";

type Mode = "main" | "decline" | "merge" | "override" | "reassign" | "withdraw";

export interface ReviewReferralSheetProps {
  referral: QueueReferral | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function isFlagged(referral: QueueReferral | null): boolean {
  return Boolean(referral && (referral.duplicateOfReferralId || referral.duplicateOfDealId));
}

export function ReviewReferralSheet({ referral, open, onOpenChange }: ReviewReferralSheetProps) {
  const accept = useAcceptReferral();
  const decline = useDeclineReferral();
  const merge = useMergeReferral();
  const reassign = useReassignReferral();
  const { checkPlaceDuplicate } = usePlaceDuplicateCheck();
  const { data: deals = [] } = useDeals();
  const profile = useProfile();
  const customer = useCustomerMatch({
    company: referral?.companyName,
    phone: referral?.contactPhone,
    address: referral?.address,
    enabled: open && Boolean(referral),
  });
  const canReassign = canReassignReferrals(profile.data);
  const assignees = useReferralAssignees(open && canReassign);

  const [mode, setMode] = React.useState<Mode>("main");
  const [reason, setReason] = React.useState<DeclineReason | "">("");
  const [note, setNote] = React.useState("");
  const [partnerMessage, setPartnerMessage] = React.useState("");
  const [mergeDealId, setMergeDealId] = React.useState("");
  const [dupName, setDupName] = React.useState<string | null>(null);
  const [overrideReason, setOverrideReason] = React.useState("");
  const [assigneeId, setAssigneeId] = React.useState("");

  const referralId = referral?.id;
  const flagged = isFlagged(referral);
  const seesPartner = useAssigneeSeesPartner(
    mode === "reassign" && assigneeId ? assigneeId : null,
    referral?.partnerId ?? null,
  );

  React.useEffect(() => {
    setMode("main");
    setReason(isFlagged(referral) ? "duplicate" : "");
    setNote("");
    setPartnerMessage("");
    setMergeDealId("");
    setDupName(null);
    setOverrideReason("");
    setAssigneeId("");
    // Keyed on the referral id so a refetch with a new object does not reset the sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, referralId]);

  React.useEffect(() => {
    if (!open || !referral) return;
    let live = true;
    void checkPlaceDuplicate({
      placeId: referral.placeId,
      name: referral.companyName,
      phone: referral.contactPhone,
      address: referral.address,
    }).then((m) => { if (live) setDupName(m?.companyName ?? null); });
    return () => { live = false; };
    // Keyed on the referral id so a refetch with a new object does not re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, referralId, checkPlaceDuplicate]);

  const openDeals = React.useMemo(
    () => deals
      .filter((d) => d.stage !== "won" && d.stage !== "lost")
      .sort((a, b) => a.companyName.localeCompare(b.companyName))
      .map((d) => ({ value: d.id, label: d.companyName })),
    [deals],
  );

  const currentAssigneeId = referral?.assignedUserId ?? null;
  const assigneeOptions = React.useMemo(
    () => (assignees.data ?? [])
      .filter((a) => a.id !== currentAssigneeId)
      .map((a) => ({ value: a.id, label: a.name })),
    [assignees.data, currentAssigneeId],
  );

  if (!referral) return null;

  const currentOwner = (assignees.data ?? []).find((a) => a.id === referral.assignedUserId)?.name ?? null;
  const pickedName = (assignees.data ?? []).find((a) => a.id === assigneeId)?.name?.trim() || null;
  const flags = icpFlagLabels(referral.icpFlags);

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  const onAccept = (reasonText?: string) => run(async () => {
    const res = await accept.mutateAsync(
      reasonText ? { referralId: referral.id, overrideReason: reasonText } : referral.id,
    );
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
    await decline.mutateAsync({ referralId: referral.id, reason, note, partnerMessage });
    toast.success("Referral declined");
    onOpenChange(false);
  });

  const onMerge = () => run(async () => {
    if (!mergeDealId) return;
    const reasonText = overrideReason.trim();
    if (flagged && !reasonText) return;
    const res = await merge.mutateAsync(
      flagged
        ? { referralId: referral.id, dealId: mergeDealId, overrideReason: reasonText }
        : { referralId: referral.id, dealId: mergeDealId },
    );
    toast.success(mergeResultMessage(res));
    onOpenChange(false);
  });

  const onReassign = () => run(async () => {
    if (!assigneeId) return;
    await reassign.mutateAsync({ referralId: referral.id, userId: assigneeId });
    toast.success(`Reassigned to ${pickedName ?? "that teammate"}`);
    onOpenChange(false);
  });

  const submitted = new Date(referral.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const details: Array<[string, string | null]> = [
    ["Contact", referral.contactName],
    ["Phone", referral.contactPhone],
    ["Email", referral.contactEmail],
    ["Address", referral.address],
    ["Urgency", urgencyLabel(referral.urgency ?? null)],
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
            {referral.source === "portal_signed_in" && (
              <span className="text-caption text-text-muted">Sent through the partner portal</span>
            )}
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

          {flags.map((f) => (
            <p key={f} className="rounded-radius-sm bg-surface-sunken p-3 text-body-sm text-text-muted">
              {f}. Check before accepting.
            </p>
          ))}

          {flagged && (
            <p className="rounded-radius-sm bg-status-warning-bg p-3 text-body-sm text-status-warning">
              Possible duplicate of an earlier referral. Decline (duplicate) is preselected; you can still accept or merge.
            </p>
          )}

          {customer.data && (
            <p className="rounded-radius-sm bg-status-warning-bg p-3 text-body-sm text-status-warning">
              Already a customer:{" "}
              <Link to={`/pipeline/${customer.data.dealId}`} className="underline" onClick={() => onOpenChange(false)}>{customer.data.companyName}</Link> was closed won.
            </p>
          )}

          {dupName && (
            <p className="rounded-radius-sm bg-status-warning-bg p-3 text-body-sm text-status-warning">
              Possible duplicate: {dupName} is already in your team's pipeline.
            </p>
          )}

          <ReferralHistory referralId={referral.id} />

          {mode === "main" && (
            <div className="flex flex-col gap-2 pt-1">
              <Button
                variant="primary"
                loading={accept.isPending}
                disabled={accept.isPending}
                onClick={() => (flagged ? setMode("override") : onAccept())}
              >
                Accept
              </Button>
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" disabled={accept.isPending} onClick={() => setMode("merge")}>Merge</Button>
                <Button variant="secondary" className="flex-1" disabled={accept.isPending} onClick={() => setMode("decline")}>Decline</Button>
              </div>
              {canReassign && (
                <Button variant="tertiary" disabled={accept.isPending} onClick={() => setMode("reassign")}>
                  Reassign
                </Button>
              )}
              <Button variant="tertiary" disabled={accept.isPending} onClick={() => setMode("withdraw")}>
                Withdraw (partner asked)
              </Button>
            </div>
          )}

          {mode === "withdraw" && (
            <WithdrawReferralConfirm
              referralId={referral.id}
              onBack={() => setMode("main")}
              onDone={() => onOpenChange(false)}
            />
          )}

          {mode === "override" && (
            <div className="flex flex-col gap-3">
              <p className="text-body-sm text-text-muted">
                Say why you are accepting a possible duplicate. The reason is saved in the referral's history.
              </p>
              <NotesFieldWithMic
                value={overrideReason}
                onChange={setOverrideReason}
                placeholder="Why accept it anyway?"
                maxLength={500}
              />
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setMode("main")}>Back</Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  disabled={!overrideReason.trim() || accept.isPending}
                  loading={accept.isPending}
                  onClick={() => onAccept(overrideReason.trim())}
                >
                  Accept anyway
                </Button>
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
              <label htmlFor="decline-partner-message" className="-mb-1.5 text-caption font-medium text-text-muted">
                Message to the partner (they will see this, optional)
              </label>
              <NotesFieldWithMic
                id="decline-partner-message"
                value={partnerMessage}
                onChange={setPartnerMessage}
                placeholder="A short note for the partner"
                maxLength={REFERRAL_UPDATE_MAX}
              />
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
              <p className="text-body-sm text-text-muted">
                {flagged && "Say why you are merging a possible duplicate. The reason is saved in the referral's history. "}
                If another partner already has that deal, they keep the credit and this referral closes as a duplicate.
              </p>
              {flagged && (
                <NotesFieldWithMic
                  value={overrideReason}
                  onChange={setOverrideReason}
                  placeholder="Why merge it anyway?"
                  maxLength={500}
                />
              )}
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setMode("main")}>Back</Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  disabled={!mergeDealId || (flagged && !overrideReason.trim()) || merge.isPending}
                  loading={merge.isPending}
                  onClick={onMerge}
                >
                  Merge into deal
                </Button>
              </div>
            </div>
          )}

          {mode === "reassign" && (
            <div className="flex flex-col gap-3">
              {currentOwner && <p className="text-body-sm text-text-muted">Now with {currentOwner}.</p>}
              <label className="flex flex-col gap-1.5">
                <span className="text-caption font-medium text-text-muted">New owner</span>
                <Select
                  value={assigneeId}
                  onValueChange={setAssigneeId}
                  placeholder="Pick a teammate…"
                  options={assigneeOptions}
                />
              </label>
              {assigneeId && seesPartner.data === false && (
                <p className="rounded-radius-sm bg-status-warning-bg p-3 text-body-sm text-status-warning">
                  {pickedName ?? "That teammate"} can't see {referral.partnerName}'s partner record. They will still see this referral.
                </p>
              )}
              {assigneeId && seesPartner.isError && (
                <p className="text-body-sm text-text-muted">Couldn't check partner access. You can still reassign.</p>
              )}
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setMode("main")}>Back</Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  disabled={!assigneeId || seesPartner.isFetching || reassign.isPending}
                  loading={reassign.isPending}
                  onClick={onReassign}
                >
                  Reassign referral
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
