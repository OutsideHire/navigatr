/**
 * StageUpdateModal — FR-PIPE-07. Opens on every non-lost stage change (Deal
 * Detail hero or Kanban drag-drop). Shows the target stage's default probability
 * (editable) + an optional outcome note. Confirm hands (probability, note) up;
 * the caller persists stage + probability and appends the note to deal.notes.
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button, Input, NotesFieldWithMic } from "@/components/navigatr";
import { STAGE_DEFAULT_PROBABILITY, STAGE_LABEL, type Deal, type DealStage } from "../mockData";

export interface StageUpdateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal: Deal | null;
  toStage: DealStage | null;
  busy?: boolean;
  onConfirm: (probability: number, note: string) => void;
}

export function StageUpdateModal({ open, onOpenChange, deal, toStage, busy, onConfirm }: StageUpdateModalProps) {
  const [prob, setProb] = React.useState("");
  const [note, setNote] = React.useState("");

  React.useEffect(() => {
    if (open && toStage) {
      setProb(String(STAGE_DEFAULT_PROBABILITY[toStage]));
      setNote("");
    }
  }, [open, toStage]);

  if (!deal || !toStage) return null;

  const clamped = Math.max(0, Math.min(100, parseInt(prob, 10) || 0));

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
              Move {deal.companyName} to {STAGE_LABEL[toStage]}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button aria-label="Close" className="rounded-radius-sm p-1 text-text-muted hover:text-text-default">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-text-muted">Probability (%)</span>
            <Input
              type="number" inputMode="numeric" min={0} max={100}
              aria-label="Probability"
              value={prob}
              onChange={(e) => setProb(e.target.value)}
            />
          </label>

          <NotesFieldWithMic value={note} onChange={setNote} placeholder="What changed? (optional)" />

          <div className="flex gap-2 pt-1">
            <Button variant="secondary" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" className="flex-1" disabled={busy} loading={busy} onClick={() => onConfirm(clamped, note.trim())}>
              Move to {STAGE_LABEL[toStage]}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default StageUpdateModal;
