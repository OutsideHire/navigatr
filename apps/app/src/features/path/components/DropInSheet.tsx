/**
 * DropInSheet — log a field drop-in for a path stop (Path v2, Slice 3).
 *
 * Tiles → notes → optional contact name. On save:
 *   - always: record the disposition on the queue stop (usePathQueue.logVisit).
 *   - engaged outcomes (met_dm / gatekeeper / left_collateral / scheduled_callback):
 *     also create a Pipeline deal (company = business name, email/value null) and
 *     log a `drop_in` activity whose disposition auto-schedules the follow-up.
 * Places-only: no employee count, estimated value, or email captured.
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { toast } from "sonner";

import { Button, Input, NotesFieldWithMic, DispositionTile } from "@/components/navigatr";
import { DISPOSITIONS, calculateFollowUpDate, type Disposition } from "@/lib/followUpScheduling";
import type { Merchant } from "../mockData";
import { useTodayPath } from "../hooks/useTodayPath";
import { PATH_DISPOSITION_KEYS, isEngagedDisposition } from "../lib/pathDispositions";
import { useCreateDeal } from "@/features/pipeline/hooks/useCreateDeal";
import { useLogActivity } from "@/features/activities/hooks/useLogActivity";

export interface DropInSheetProps {
  merchant: Merchant | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DropInSheet({ merchant, open, onOpenChange }: DropInSheetProps) {
  const todayPath = useTodayPath();
  const logVisit = todayPath.logVisit;
  const markDealCreated = todayPath.markDealCreated;
  const createDeal = useCreateDeal();
  const logActivity = useLogActivity();

  const [selected, setSelected] = React.useState<Disposition | null>(null);
  const [notes, setNotes] = React.useState("");
  const [contactName, setContactName] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  // Synchronous guard against double-submit: `saving` state is a stale closure
  // within a single tick, so a fast double-tap can fire handleSave twice and
  // create two deals before React re-renders. The ref flips immediately.
  const savingRef = React.useRef(false);

  // Reset the form each time the sheet opens for a (possibly new) merchant.
  React.useEffect(() => {
    if (open) {
      setSelected(null);
      setNotes("");
      setContactName("");
      setSaving(false);
      savingRef.current = false;
    }
  }, [open, merchant?.id]);

  if (!merchant) return null;

  const handleSave = async () => {
    if (!selected || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    // Always record the disposition on the queue stop.
    await logVisit(merchant.id, selected);

    if (isEngagedDisposition(selected)) {
      try {
        const followUpDate = calculateFollowUpDate(selected);
        const { id: dealId } = await createDeal.mutateAsync({
          companyName: merchant.name,
          address: merchant.address,
          industry: merchant.category,
          contactName: contactName.trim() || merchant.name,
          contactPhone: merchant.phone ?? "",
          stage: "new",
          probability: 20,
          leadSource: "path_dropin",
          notes: notes.trim() || undefined,
        });
        await logActivity.mutateAsync({
          dealId,
          type: "drop_in",
          disposition: selected,
          outcomeNotes: notes.trim(),
          followUpDate,
        });
        // Both mutations succeeded — only now is a deal truly created.
        await markDealCreated(merchant.id);
        toast.success(`Deal created for ${merchant.name}`);
        // Known accepted edge for this slice: if createDeal succeeds but
        // logActivity throws, an orphan deal exists with no drop-in activity /
        // follow-up. We don't roll back the deal here; the visit is recorded
        // and dealCreated stays false, so the summary won't over-count.
      } catch {
        toast.error("Couldn't finish logging — the visit was saved but the deal/follow-up may not have been.");
      }
    } else {
      toast.success(`Visit logged: ${DISPOSITIONS[selected].label}`);
    }
    setSaving(false);
    savingRef.current = false;
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-radius-lg bg-surface-default p-5 shadow-card-hover sm:inset-0 sm:bottom-auto sm:top-1/2 sm:max-h-[85dvh] sm:-translate-y-1/2 sm:rounded-radius-lg"
        >
          <div className="flex items-center justify-between pb-3">
            <Dialog.Title className="text-heading-sm text-text-default">
              Log drop-in · {merchant.name}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button aria-label="Close" className="rounded-radius-sm p-1 text-text-muted hover:text-text-default">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
            <div className="grid grid-cols-2 gap-2">
              {PATH_DISPOSITION_KEYS.map((key) => (
                <DispositionTile
                  key={key}
                  tier={DISPOSITIONS[key].tier}
                  title={DISPOSITIONS[key].label}
                  description=""
                  selected={selected === key}
                  onClick={() => setSelected(key)}
                />
              ))}
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-text-muted">Contact name (optional)</span>
              <Input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Who did you talk to?"
              />
            </label>

            <NotesFieldWithMic
              value={notes}
              onChange={setNotes}
              placeholder="What happened on this visit?"
            />
          </div>

          <div className="flex gap-2 pt-4">
            <Button variant="secondary" onClick={() => onOpenChange(false)} className="flex-1">
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={!selected || saving}
              loading={saving}
              className="flex-1"
            >
              Save
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default DropInSheet;
