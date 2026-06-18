/**
 * QualificationEditSheet — FR-PIPE-08 edit view.
 *
 * Radix Dialog (mirrors StageUpdateModal's shell) for editing the Merchant
 * Services qualification on deals.profession_data. Seeds six controlled
 * fields from readMerchantQualification on open, then persists via
 * useUpdateDeal. Numeric fields coerce blank → undefined so the column is
 * left unset rather than written as 0/NaN.
 */

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button, Checkbox, Input } from "@/components/navigatr";
import {
  ACCEPTANCE_METHOD_LABELS,
  readMerchantQualification,
} from "../lib/merchantQualification";
import { useUpdateDeal } from "../hooks/useUpdateDeal";
import type { Deal } from "../mockData";

function numOrUndef(s: string): number | undefined {
  const n = Number(s);
  return s.trim() !== "" && Number.isFinite(n) ? n : undefined;
}

export interface QualificationEditSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal: Deal;
}

export function QualificationEditSheet({ open, onOpenChange, deal }: QualificationEditSheetProps) {
  const update = useUpdateDeal();

  const [annualVolume, setAnnualVolume] = React.useState("");
  const [acceptanceMethods, setAcceptanceMethods] = React.useState<string[]>([]);
  const [currentProcessor, setCurrentProcessor] = React.useState("");
  const [currentEffectiveRate, setCurrentEffectiveRate] = React.useState("");
  const [posTerminal, setPosTerminal] = React.useState("");
  const [avgTicketSize, setAvgTicketSize] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    const q = readMerchantQualification(deal.professionData);
    setAnnualVolume(q?.annualVolume !== undefined ? String(q.annualVolume) : "");
    setAcceptanceMethods(q?.acceptanceMethods ?? []);
    setCurrentProcessor(q?.currentProcessor ?? "");
    setCurrentEffectiveRate(q?.currentEffectiveRate !== undefined ? String(q.currentEffectiveRate) : "");
    setPosTerminal(q?.posTerminal ?? "");
    setAvgTicketSize(q?.avgTicketSize !== undefined ? String(q.avgTicketSize) : "");
  }, [open, deal.professionData]);

  const toggleMethod = (key: string, checked: boolean) => {
    setAcceptanceMethods((prev) =>
      checked ? [...prev, key] : prev.filter((m) => m !== key),
    );
  };

  const onSave = async () => {
    try {
      await update.mutateAsync({
        id: deal.id,
        patch: {
          professionData: {
            profession: "merchant_services",
            annualVolume: numOrUndef(annualVolume),
            acceptanceMethods,
            currentProcessor: currentProcessor.trim() || undefined,
            currentEffectiveRate: numOrUndef(currentEffectiveRate),
            posTerminal: posTerminal.trim() || undefined,
            avgTicketSize: numOrUndef(avgTicketSize),
          },
        },
      });
      toast.success("Qualification updated");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save qualification");
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-radius-lg bg-surface-default p-5 shadow-card-hover sm:inset-0 sm:bottom-auto sm:top-1/2 sm:max-h-[85dvh] sm:-translate-y-1/2 sm:rounded-radius-lg"
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-heading-sm text-text-default">
              Edit qualification
            </Dialog.Title>
            <Dialog.Close asChild>
              <button aria-label="Close" className="rounded-radius-sm p-1 text-text-muted hover:text-text-default">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-text-muted">Annual volume</span>
            <Input
              type="number" inputMode="numeric" min={0} prefix="$"
              aria-label="Annual volume"
              value={annualVolume}
              onChange={(e) => setAnnualVolume(e.target.value)}
            />
          </label>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-caption font-medium text-text-muted">Acceptance methods</legend>
            {Object.entries(ACCEPTANCE_METHOD_LABELS).map(([key, label]) => (
              <Checkbox
                key={key}
                id={`accept-${key}`}
                label={label}
                checked={acceptanceMethods.includes(key)}
                onCheckedChange={(c) => toggleMethod(key, c)}
              />
            ))}
          </fieldset>

          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-text-muted">Current processor</span>
            <Input
              aria-label="Current processor"
              value={currentProcessor}
              onChange={(e) => setCurrentProcessor(e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-text-muted">Current effective rate</span>
            <Input
              type="number" inputMode="decimal" min={0} suffix="%"
              aria-label="Current effective rate"
              value={currentEffectiveRate}
              onChange={(e) => setCurrentEffectiveRate(e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-text-muted">POS / terminal</span>
            <Input
              aria-label="POS / terminal"
              value={posTerminal}
              onChange={(e) => setPosTerminal(e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-text-muted">Avg ticket size</span>
            <Input
              type="number" inputMode="numeric" min={0} prefix="$"
              aria-label="Avg ticket size"
              value={avgTicketSize}
              onChange={(e) => setAvgTicketSize(e.target.value)}
            />
          </label>

          <div className="flex gap-2 pt-1">
            <Button variant="secondary" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" className="flex-1" disabled={update.isPending} loading={update.isPending} onClick={onSave}>
              Save
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default QualificationEditSheet;
