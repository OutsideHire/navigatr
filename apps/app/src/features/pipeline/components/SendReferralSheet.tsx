/**
 * SendReferralSheet — FR-PIPE-09. Opens from the Deal Detail Quick actions
 * card ("Send as referral"). Pick a partner + optional note, then record an
 * outbound referral via useReferDeal (inserts a partner_deals row). Same Radix
 * Dialog shell + navigatr primitives as StageUpdateModal.
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button, Select, NotesFieldWithMic } from "@/components/navigatr";
import { usePartners } from "@/features/partners/hooks/usePartners";
import { useReferDeal } from "@/features/partners/hooks/useReferDeal";
import { type Deal } from "../mockData";

export interface SendReferralSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal: Deal;
}

export function SendReferralSheet({ open, onOpenChange, deal }: SendReferralSheetProps) {
  const { data: partners = [] } = usePartners();
  const refer = useReferDeal();

  const [partnerId, setPartnerId] = React.useState("");
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    setPartnerId("");
    setNotes("");
  }, [open]);

  const hasPartners = partners.length > 0;

  const onSend = async () => {
    if (!partnerId) return;
    try {
      await refer.mutateAsync({ dealId: deal.id, partnerId, notes: notes.trim() || undefined });
      toast.success(`Referred ${deal.companyName}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send referral");
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-md flex-col gap-4 rounded-t-radius-lg bg-surface-default p-5 shadow-card-hover sm:inset-0 sm:bottom-auto sm:top-1/2 sm:max-h-[85dvh] sm:-translate-y-1/2 sm:rounded-radius-lg"
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-heading-sm text-text-default">
              Refer {deal.companyName}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button aria-label="Close" className="rounded-radius-sm p-1 text-text-muted hover:text-text-default">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          {!hasPartners ? (
            <p className="text-body-md text-text-muted">No partners yet — add one in Partners.</p>
          ) : (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-caption font-medium text-text-muted">Partner</span>
                <Select
                  value={partnerId}
                  onValueChange={setPartnerId}
                  placeholder="Select a partner…"
                  options={partners.map((p) => ({ value: p.id, label: `${p.name} · ${p.company}` }))}
                />
              </label>

              <NotesFieldWithMic
                value={notes}
                onChange={setNotes}
                placeholder="Add a note for the partner (optional)"
              />
            </>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="secondary" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              disabled={!partnerId || refer.isPending}
              loading={refer.isPending}
              onClick={onSend}
            >
              Send referral
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default SendReferralSheet;
