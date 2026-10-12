/**
 * ShareUpdateSheet: write an update the referring partner sees on their
 * referral (spec 5.7, FR-PORT-74). This is the only text that ever leaves the
 * app for the portal, so the sheet says so. Partners with portal access also
 * get it by email.
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button, NotesFieldWithMic } from "@/components/navigatr";
import { REFERRAL_UPDATE_MAX, usePublishReferralUpdate } from "../hooks/useReferralUpdates";

export interface ShareUpdateSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  referralId: string;
  /** The partner's name, or "the partner" when it is hidden from this viewer. */
  partnerLabel: string;
}

export function ShareUpdateSheet({ open, onOpenChange, referralId, partnerLabel }: ShareUpdateSheetProps) {
  const publish = usePublishReferralUpdate(referralId);
  const [body, setBody] = React.useState("");
  const inFlight = React.useRef(false);

  React.useEffect(() => {
    if (open) setBody("");
  }, [open]);

  const sentenceLabel = partnerLabel.charAt(0).toUpperCase() + partnerLabel.slice(1);
  const length = body.trim().length;
  const tooLong = length > REFERRAL_UPDATE_MAX;
  const canShare = length > 0 && !tooLong && !publish.isPending;

  const onShare = async () => {
    if (!canShare || inFlight.current) return;
    inFlight.current = true;
    try {
      await publish.mutateAsync(body);
      toast.success(`Update shared with ${partnerLabel}.`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't share the update");
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col gap-4 overflow-y-auto rounded-t-radius-lg bg-surface-default p-5 text-text-default shadow-card-hover sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-[480px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-radius-lg sm:max-h-[80vh]"
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-heading-sm text-text-default">Share an update with {partnerLabel}</Dialog.Title>
            <Dialog.Close asChild>
              <button aria-label="Close" className="rounded-radius-sm p-1 text-text-muted hover:text-text-default">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <p className="text-body-sm text-text-muted">
            {sentenceLabel} sees this on their referral, word for word, and gets it by email if they have portal access. This is not an internal note.
          </p>

          <NotesFieldWithMic
            value={body}
            onChange={setBody}
            placeholder="What should the partner know?"
            maxLength={REFERRAL_UPDATE_MAX}
          />
          <p className={tooLong ? "text-caption text-status-danger" : "text-caption text-text-subtle"}>
            {length}/{REFERRAL_UPDATE_MAX}
          </p>

          <div className="flex gap-2 pt-1">
            <Button variant="secondary" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" className="flex-1" disabled={!canShare} loading={publish.isPending} onClick={onShare}>
              Share update
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default ShareUpdateSheet;
