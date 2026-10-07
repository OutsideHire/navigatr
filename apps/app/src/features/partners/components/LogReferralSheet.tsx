/**
 * LogReferralSheet: record "this partner told me about a business" before any
 * deal exists. The referral lands in Referrals to review (status Submitted),
 * where Accept turns it into a deal. Plain fields in Phase 0; the Google place
 * search arrives with the Phase 1 portal form.
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button, Input, NotesFieldWithMic } from "@/components/navigatr";
import { useLogReferral } from "../hooks/useReferralMutations";

export interface LogReferralSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partnerId: string;
  partnerName: string;
}

const EMPTY = { companyName: "", contactName: "", contactPhone: "", contactEmail: "", address: "", notes: "" };

const FIELDS: Array<{ key: keyof typeof EMPTY; label: string; type: string; autoComplete: string }> = [
  { key: "companyName", label: "Business name", type: "text", autoComplete: "organization" },
  { key: "contactName", label: "Contact name", type: "text", autoComplete: "name" },
  { key: "contactPhone", label: "Phone", type: "tel", autoComplete: "tel" },
  { key: "contactEmail", label: "Email", type: "email", autoComplete: "email" },
  { key: "address", label: "Address", type: "text", autoComplete: "street-address" },
];

export function LogReferralSheet({ open, onOpenChange, partnerId, partnerName }: LogReferralSheetProps) {
  const log = useLogReferral();
  const [form, setForm] = React.useState(EMPTY);

  React.useEffect(() => { setForm(EMPTY); }, [open]);

  const set = (key: keyof typeof EMPTY) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const canSubmit = form.companyName.trim() !== "" && !log.isPending;

  const onSubmit = async () => {
    if (!canSubmit) return;
    try {
      await log.mutateAsync({ partnerId, ...form });
      toast.success("Referral logged. It's in Referrals to review.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't log the referral");
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
            <Dialog.Title className="text-heading-sm text-text-default">Log a referral from {partnerName}</Dialog.Title>
            <Dialog.Close asChild>
              <button aria-label="Close" className="rounded-radius-sm p-1 text-text-muted hover:text-text-default">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          {FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-text-muted">{f.label}</span>
              <Input
                aria-label={f.label}
                type={f.type}
                autoComplete={f.autoComplete}
                value={form[f.key]}
                onChange={(e) => set(f.key)(e.target.value)}
              />
            </label>
          ))}

          <NotesFieldWithMic value={form.notes} onChange={set("notes")} placeholder="What did the partner tell you?" />

          <div className="flex gap-2 pt-1">
            <Button variant="secondary" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" className="flex-1" disabled={!canSubmit} loading={log.isPending} onClick={onSubmit}>
              Log referral
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default LogReferralSheet;
