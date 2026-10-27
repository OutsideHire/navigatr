// apps/app/src/features/partners/components/ReviewFormSubmissionSheet.tsx
/**
 * ReviewFormSubmissionSheet: triage one public referral form submission
 * (FR-PORT-32). Step 1 says who sent it: a partner the reviewer can see, a new
 * partner (created now, owned by the reviewer), or no partner. Step 2 is the
 * same Accept / Merge / Decline as a referral:
 *   - with a partner, the submission first becomes a referral
 *     (attribute_form_submission) and the existing referral RPCs finish it.
 *     The referral id (and a newly created partner's id) is kept, so a failed
 *     or duplicate accept never attributes twice or creates the partner twice;
 *   - with no partner, the submission RPCs act on it directly (accept makes a
 *     deal with lead source Referral form and the first follow-up task).
 * Advisory lines (possible duplicate, looks like a chain) never block.
 * First referral wins (FR-PORT-46, 47): when attributing finds an earlier open
 * referral or active deal, the referral is flagged like a partner's own portal
 * referral. Decline (duplicate) is preselected, and accepting or merging needs
 * a reason. A merge that only finds out on attributing stops at the reason
 * first, so the reviewer always sees the flag before anything is merged.
 * Managers and administrators can reassign it before anyone says who sent it.
 * Same Radix Dialog shell and copy style as ReviewReferralSheet.
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button, Input, NotesFieldWithMic, PhoneWithClickToCall, Select } from "@/components/navigatr";
import { useProfile } from "@/features/auth/useProfile";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import { normalizeEmail, phoneToE164 } from "@/lib/contactValidation";
import { useAuth } from "@/stores/auth";
import { useCreatePartner } from "../hooks/useCreatePartner";
import { usePartners } from "../hooks/usePartners";
import { useAcceptReferral, useDeclineReferral, useMergeReferral } from "../hooks/useReferralMutations";
import { useReferralAssignees } from "../hooks/useReassignReferral";
import { useFormSubmissionAdvice, type QueueSubmission } from "../hooks/useFormSubmissionQueue";
import {
  useAcceptFormSubmission,
  useAttributeFormSubmission,
  useDeclineFormSubmission,
  useMergeFormSubmission,
  useReassignFormSubmission,
} from "../hooks/useFormSubmissionMutations";
import {
  SUBMISSION_DECLINE_REASON_OPTIONS,
  canReassignReferrals,
  formSubmissionSourceLabel,
  icpFlagLabels,
  mergeResultMessage,
  type DeclineReason,
} from "../lib/referrals";

type Mode = "main" | "decline" | "merge" | "override" | "reassign";
type Who = "existing" | "new" | "none";

const WHO_OPTIONS: Array<{ value: Who; label: string }> = [
  { value: "existing", label: "A partner" },
  { value: "new", label: "New partner" },
  { value: "none", label: "No partner" },
];

const EMPTY_PARTNER = { name: "", company: "", email: "", phone: "" };
type NewPartnerField = keyof typeof EMPTY_PARTNER;

export interface ReviewFormSubmissionSheetProps {
  submission: QueueSubmission | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ReviewFormSubmissionSheet({ submission: submissionProp, open, onOpenChange }: ReviewFormSubmissionSheetProps) {
  // Snapshot for the whole session. Attributing sets triaged_at, so the queue
  // refetch drops the row and the parent may pass null mid-flow; the sheet keeps
  // rendering the snapshot and only changes on close or a different submission.
  const [submission, setSnapshot] = React.useState<QueueSubmission | null>(submissionProp);
  if (!open) {
    if (submission !== submissionProp) setSnapshot(submissionProp);
  } else if (submissionProp && submissionProp.id !== submission?.id) {
    setSnapshot(submissionProp);
  }
  // Bumped on every open, switch and close, so a completion from an earlier
  // session (even of the same submission after a close and reopen) is ignored.
  const sessionRef = React.useRef(0);
  const viewerId = useAuth((s) => s.user?.id);
  const profile = useProfile();
  const canReassign = canReassignReferrals(profile.data);
  const assignees = useReferralAssignees(open && canReassign);
  const { data: partners = [] } = usePartners();
  const { data: deals = [] } = useDeals();
  const advice = useFormSubmissionAdvice(open ? submission?.id ?? null : null);
  const createPartner = useCreatePartner();
  const attribute = useAttributeFormSubmission();
  const acceptSubmission = useAcceptFormSubmission();
  const declineSubmission = useDeclineFormSubmission();
  const mergeSubmission = useMergeFormSubmission();
  const reassign = useReassignFormSubmission();
  const acceptReferral = useAcceptReferral();
  const declineReferral = useDeclineReferral();
  const mergeReferral = useMergeReferral();

  const [mode, setMode] = React.useState<Mode>("main");
  const [who, setWho] = React.useState<Who | null>(null);
  const [search, setSearch] = React.useState("");
  const [partnerId, setPartnerId] = React.useState("");
  const [newPartner, setNewPartner] = React.useState(EMPTY_PARTNER);
  const [createdPartnerId, setCreatedPartnerId] = React.useState<string | null>(null);
  const [referralId, setReferralId] = React.useState<string | null>(null);
  const [flagged, setFlagged] = React.useState(false);
  const [overrideReason, setOverrideReason] = React.useState("");
  const [reason, setReason] = React.useState<DeclineReason | "">("");
  const [note, setNote] = React.useState("");
  const [mergeDealId, setMergeDealId] = React.useState("");
  const [assigneeId, setAssigneeId] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const submissionId = submission?.id;
  React.useEffect(() => {
    setMode("main");
    setWho(null);
    setSearch("");
    setPartnerId("");
    setNewPartner(EMPTY_PARTNER);
    setCreatedPartnerId(null);
    setReferralId(null);
    setFlagged(false);
    setOverrideReason("");
    setReason("");
    setNote("");
    setMergeDealId("");
    setAssigneeId("");
    setBusy(false);
    sessionRef.current += 1;
    // Keyed on the submission id so a refetch with a new object does not reset the sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, submissionId]);

  const partnerOptions = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return partners
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.company.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ value: p.id, label: p.company ? `${p.name} · ${p.company}` : p.name }));
  }, [partners, search]);

  const openDeals = React.useMemo(
    () => deals
      .filter((d) => d.stage !== "won" && d.stage !== "lost")
      .sort((a, b) => a.companyName.localeCompare(b.companyName))
      .map((d) => ({ value: d.id, label: d.companyName })),
    [deals],
  );

  const currentAssigneeId = submission?.assignedUserId ?? null;
  const assigneeOptions = React.useMemo(
    () => (assignees.data ?? [])
      .filter((a) => a.id !== currentAssigneeId)
      .map((a) => ({ value: a.id, label: a.name })),
    [assignees.data, currentAssigneeId],
  );

  if (!submission) return null;

  const attributed = referralId !== null;
  const locked = attributed || createdPartnerId !== null;
  const viaPartner = attributed || who === "existing" || who === "new";
  const whoReady =
    attributed ||
    who === "none" ||
    (who === "existing" && partnerId !== "") ||
    (who === "new" && newPartner.name.trim() !== "");
  const pickedName = (assignees.data ?? []).find((a) => a.id === assigneeId)?.name?.trim() || null;
  const chainLines = icpFlagLabels(advice.data?.chainBrand ? [`chain:${advice.data.chainBrand}`] : []);
  const received = new Date(submission.submittedAt).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });

  const setField = (k: NewPartnerField) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setNewPartner((p) => ({ ...p, [k]: e.target.value }));

  // A completion that lands after the sheet closed or moved to another
  // submission is ignored: no toast, no close, no state writes.
  const run = async (fn: (live: () => boolean) => Promise<void>) => {
    const key = sessionRef.current;
    const live = () => sessionRef.current === key;
    setBusy(true);
    try {
      await fn(live);
    } catch (err) {
      if (live()) toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      if (live()) setBusy(false);
    }
  };

  const done = (live: () => boolean, message: string) => {
    if (!live()) return;
    toast.success(message);
    onOpenChange(false);
  };

  // The referral this submission becomes. Made once; every later step reuses it.
  const ensureReferral = async (live: () => boolean): Promise<{ referralId: string; flagged: boolean }> => {
    if (referralId) return { referralId, flagged };
    let pid = who === "new" ? createdPartnerId : partnerId;
    if (who === "new" && !pid) {
      const created = await createPartner.mutateAsync({
        name: newPartner.name.trim(),
        company: newPartner.company.trim(),
        type: "other",
        email: normalizeEmail(newPartner.email) ?? undefined,
        phone: phoneToE164(newPartner.phone) ?? undefined,
      });
      pid = created.id;
      if (live()) setCreatedPartnerId(created.id);
    }
    const res = await attribute.mutateAsync({ submissionId: submission.id, partnerId: pid as string });
    const isDuplicate = Boolean(res.duplicateOfReferralId || res.duplicateOfDealId);
    if (live()) {
      setReferralId(res.referralId);
      if (isDuplicate) {
        setFlagged(true);
        setReason((r) => r || "duplicate");
      }
    }
    return { referralId: res.referralId, flagged: isDuplicate };
  };

  const onAccept = (reasonText?: string) => run(async (live) => {
    if (!viaPartner) {
      await acceptSubmission.mutateAsync(submission.id);
      done(live, "Accepted. Deal created.");
      return;
    }
    const ref = await ensureReferral(live);
    // A probable duplicate is accepted only with a written reason.
    if (ref.flagged && !reasonText) {
      if (live()) setMode("override");
      return;
    }
    const res = await acceptReferral.mutateAsync(
      reasonText ? { referralId: ref.referralId, overrideReason: reasonText } : ref.referralId,
    );
    if (res.result === "accepted") {
      done(live, "Accepted. Deal created.");
      return;
    }
    if (!live()) return;
    toast.error("Already in your team's pipeline");
    setMergeDealId(res.dealId ?? "");
    setMode("merge");
  });

  const onDecline = () => run(async (live) => {
    if (!reason) return;
    if (viaPartner) {
      const { referralId: rid } = await ensureReferral(live);
      await declineReferral.mutateAsync({ referralId: rid, reason, note });
    } else {
      await declineSubmission.mutateAsync({ submissionId: submission.id, reason, note });
    }
    done(live, "Referral declined");
  });

  const onMerge = () => run(async (live) => {
    if (!mergeDealId) return;
    if (viaPartner) {
      const ref = await ensureReferral(live);
      const reasonText = overrideReason.trim();
      // A probable duplicate is merged only with a written reason. The merge
      // mode shows the reason field once flagged, so the reviewer sees it first.
      if (ref.flagged && !reasonText) return;
      const res = await mergeReferral.mutateAsync(
        ref.flagged
          ? { referralId: ref.referralId, dealId: mergeDealId, overrideReason: reasonText }
          : { referralId: ref.referralId, dealId: mergeDealId },
      );
      done(live, mergeResultMessage(res));
      return;
    }
    await mergeSubmission.mutateAsync({ submissionId: submission.id, dealId: mergeDealId });
    done(live, "Merged into the existing deal");
  });

  const onReassign = () => run(async (live) => {
    if (!assigneeId) return;
    await reassign.mutateAsync({ submissionId: submission.id, userId: assigneeId });
    done(live, `Reassigned to ${pickedName ?? "that teammate"}`);
  });

  const details: Array<[string, React.ReactNode]> = [
    ["Contact", submission.contactName],
    ["Phone", submission.contactPhone ? <PhoneWithClickToCall phoneNumber={submission.contactPhone} size="lg" /> : null],
    ["Email", submission.contactEmail ? (
      <a href={`mailto:${submission.contactEmail}`} className="inline-flex min-h-11 items-center text-accent-blue hover:underline">
        {submission.contactEmail}
      </a>
    ) : null],
    ["Who referred", submission.referredByText],
    ["Sender's email", submission.referrerEmail],
    ["Received", received],
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
              <button aria-label="Close" className="inline-flex h-11 w-11 items-center justify-center rounded-radius-sm text-text-muted hover:text-text-default">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-body-strong text-text-default">{submission.companyName}</span>
            <span className="text-caption text-text-muted">
              {formSubmissionSourceLabel(submission.linkType, submission.assignedUserId === viewerId)}
            </span>
          </div>

          <dl className="grid grid-cols-[auto,1fr] items-center gap-x-3 gap-y-1">
            {details.filter(([, v]) => v).map(([k, v]) => (
              <React.Fragment key={k}>
                <dt className="text-caption text-text-subtle">{k}</dt>
                <dd className="text-body-md text-text-default">{v}</dd>
              </React.Fragment>
            ))}
          </dl>

          {submission.notes && (
            <p className="whitespace-pre-wrap text-body-md text-text-muted">{submission.notes}</p>
          )}

          {chainLines.map((f) => (
            <p key={f} className="rounded-radius-sm bg-surface-sunken p-3 text-body-sm text-text-muted">
              {f}. Check before accepting.
            </p>
          ))}
          {advice.data?.duplicateDeal && (
            <p className="rounded-radius-sm bg-status-warning-bg p-3 text-body-sm text-status-warning">
              Possible duplicate: {advice.data.duplicateDeal.companyName} is already in your team's pipeline.
            </p>
          )}
          {advice.data?.duplicateReferral && (
            <p className="rounded-radius-sm bg-status-warning-bg p-3 text-body-sm text-status-warning">
              Possible duplicate of an open referral: {advice.data.duplicateReferral.companyName}.
            </p>
          )}
          {flagged && (
            <p className="rounded-radius-sm bg-status-warning-bg p-3 text-body-sm text-status-warning">
              Possible duplicate of an earlier referral. Decline (duplicate) is preselected; you can still accept or merge.
            </p>
          )}

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-caption font-medium text-text-muted">Who sent this?</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {WHO_OPTIONS.map((o) => (
                <Button
                  key={o.value}
                  type="button"
                  size="lg"
                  className="sm:px-3"
                  variant={who === o.value ? "primary" : "secondary"}
                  aria-pressed={who === o.value}
                  disabled={locked || busy}
                  onClick={() => setWho(o.value)}
                >
                  {o.label}
                </Button>
              ))}
            </div>
            {who === "existing" && (
              <div className="flex flex-col gap-2">
                <Input
                  aria-label="Search partners"
                  placeholder="Search partners"
                  value={search}
                  disabled={locked || busy}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <Select
                  aria-label="Pick a partner…"
                  value={partnerId}
                  onValueChange={setPartnerId}
                  placeholder="Pick a partner…"
                  options={partnerOptions}
                  disabled={locked || busy}
                />
                {partners.length === 0 && (
                  <p className="text-caption text-text-subtle">No partners yet. Pick New partner to add one.</p>
                )}
              </div>
            )}
            {who === "new" && (
              <div className="flex flex-col gap-2">
                <Input aria-label="Partner name" placeholder="Name (required)" value={newPartner.name} disabled={locked || busy} onChange={setField("name")} />
                <Input aria-label="Partner company" placeholder="Company" value={newPartner.company} disabled={locked || busy} onChange={setField("company")} />
                <Input aria-label="Partner email" type="email" placeholder="Email" value={newPartner.email} disabled={locked || busy} onChange={setField("email")} />
                <Input aria-label="Partner phone" type="tel" placeholder="Phone" value={newPartner.phone} disabled={locked || busy} onChange={setField("phone")} />
              </div>
            )}
          </fieldset>

          {mode === "main" && (
            <div className="flex flex-col gap-2 pt-1">
              {!whoReady && <p className="text-caption text-text-subtle">Say who sent this to continue.</p>}
              <Button
                variant="primary"
                size="lg"
                loading={busy}
                disabled={!whoReady || busy}
                onClick={() => (flagged ? setMode("override") : onAccept())}
              >
                Accept
              </Button>
              <div className="flex gap-2">
                <Button variant="secondary" size="lg" className="flex-1" disabled={!whoReady || busy} onClick={() => setMode("merge")}>Merge</Button>
                <Button variant="secondary" size="lg" className="flex-1" disabled={!whoReady || busy} onClick={() => setMode("decline")}>Decline</Button>
              </div>
              {canReassign && !attributed && (
                <Button variant="tertiary" size="lg" disabled={busy} onClick={() => setMode("reassign")}>
                  Reassign
                </Button>
              )}
            </div>
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
                <Button variant="secondary" size="lg" className="flex-1" disabled={busy} onClick={() => setMode("main")}>Back</Button>
                <Button
                  variant="primary"
                  size="lg"
                  className="flex-1"
                  disabled={!overrideReason.trim() || busy}
                  loading={busy}
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
                  options={SUBMISSION_DECLINE_REASON_OPTIONS}
                />
              </label>
              <NotesFieldWithMic value={note} onChange={setNote} placeholder="Internal note (optional)" />
              <div className="flex gap-2">
                <Button variant="secondary" size="lg" className="flex-1" disabled={busy} onClick={() => setMode("main")}>Back</Button>
                <Button variant="primary" size="lg" className="flex-1" disabled={!reason || !whoReady || busy} loading={busy} onClick={onDecline}>
                  Decline referral
                </Button>
              </div>
            </div>
          )}

          {mode === "merge" && (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-caption font-medium text-text-muted">Existing deal</span>
                <Select value={mergeDealId} onValueChange={setMergeDealId} placeholder="Pick a deal…" options={openDeals} />
              </label>
              {flagged && (
                <>
                  <p className="text-body-sm text-text-muted">
                    Say why you are merging a possible duplicate. The reason is saved in the referral's history.
                    If another partner already has that deal, they keep the credit and this referral closes as a duplicate.
                  </p>
                  <NotesFieldWithMic
                    value={overrideReason}
                    onChange={setOverrideReason}
                    placeholder="Why merge it anyway?"
                    maxLength={500}
                  />
                </>
              )}
              <div className="flex gap-2">
                <Button variant="secondary" size="lg" className="flex-1" disabled={busy} onClick={() => setMode("main")}>Back</Button>
                <Button
                  variant="primary"
                  size="lg"
                  className="flex-1"
                  disabled={!mergeDealId || !whoReady || (flagged && !overrideReason.trim()) || busy}
                  loading={busy}
                  onClick={onMerge}
                >
                  Merge into deal
                </Button>
              </div>
            </div>
          )}

          {mode === "reassign" && (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-caption font-medium text-text-muted">New owner</span>
                <Select value={assigneeId} onValueChange={setAssigneeId} placeholder="Pick a teammate…" options={assigneeOptions} />
              </label>
              <div className="flex gap-2">
                <Button variant="secondary" size="lg" className="flex-1" disabled={busy} onClick={() => setMode("main")}>Back</Button>
                <Button variant="primary" size="lg" className="flex-1" disabled={!assigneeId || busy} loading={busy} onClick={onReassign}>
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

export default ReviewFormSubmissionSheet;
