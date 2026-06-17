/**
 * DropInSheet — log a field drop-in for a path stop.
 *
 * Explicit-commit: tapping a disposition tile only *selects* it. Nothing is
 * saved until the rep taps "Log Stop" in the footer. On commit:
 *   - always: record the disposition on the queue stop (useTodayPath.logVisit).
 *   - follow-up outcomes (schedulesFollowUp === true): also create a Pipeline
 *     deal (company = business name, contact = business name) and log a
 *     `drop_in` activity whose disposition auto-schedules the follow-up.
 *   - terminal outcomes: log the visit only — no deal.
 *
 * Follow-Up Requested reveals an inline date picker (default +7 calendar days,
 * min = today); the footer "Log Stop" button commits with the chosen date.
 *
 * Voice note: disabled "Coming soon" placeholder. The recorder hook/component
 * and upload helper remain in the repo, unused here, for Phase 2 re-wiring.
 *
 * Places-only: no employee count, estimated value, or email captured.
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Mic, X } from "lucide-react";
import { toast } from "sonner";

import { Button, Input, NotesFieldWithMic, DispositionTile } from "@/components/navigatr";
import {
  DISPOSITIONS,
  calculateFollowUpDate,
  schedulesFollowUp,
  type Disposition,
} from "@/lib/followUpScheduling";
import type { Merchant } from "../mockData";
import { useTodayPath } from "../hooks/useTodayPath";
import { PATH_DISPOSITION_KEYS } from "../lib/pathDispositions";
import { todayISO } from "../lib/today";
import { useCreateDeal } from "@/features/pipeline/hooks/useCreateDeal";
import { useLogActivity } from "@/features/activities/hooks/useLogActivity";

/** Default follow-up date for the inline picker: today + N calendar days, yyyy-mm-dd. */
function plusDaysISODate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export interface DropInSheetProps {
  merchant: Merchant | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired after a successful commit, with the chosen disposition. Lets running
   *  mode advance to the next stop once a visit is logged. */
  onLogged?: (disposition: Disposition) => void;
}

export function DropInSheet({ merchant, open, onOpenChange, onLogged }: DropInSheetProps) {
  const todayPath = useTodayPath();
  const logVisit = todayPath.logVisit;
  const markDealCreated = todayPath.markDealCreated;
  // Already-created deals must not be duplicated when a stop is re-logged.
  const alreadyDealCreated = merchant
    ? todayPath.stops.find((s) => s.merchantId === merchant.id)?.dealCreated ?? false
    : false;
  const createDeal = useCreateDeal();
  const logActivity = useLogActivity();

  const [selected, setSelected] = React.useState<Disposition | null>(null);
  const [notes, setNotes] = React.useState("");
  const [customDate, setCustomDate] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  // Synchronous guard against double-submit: `saving` state is a stale closure
  // within a single tick, so a fast double-tap can fire commit() twice and
  // create two deals before React re-renders. The ref flips immediately.
  const savingRef = React.useRef(false);

  // Reset the form each time the sheet opens for a (possibly new) merchant.
  React.useEffect(() => {
    if (open) {
      setSelected(null);
      setNotes("");
      setCustomDate(plusDaysISODate(7));
      setSaving(false);
      savingRef.current = false;
    }
  }, [open, merchant?.id]);

  if (!merchant) return null;

  const commit = async (disposition: Disposition, customDateStr?: string) => {
    if (!merchant || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      // Always record the disposition on the queue stop.
      await logVisit(merchant.id, disposition);
    } catch {
      // The visit itself failed to save — let the rep retry without losing the
      // sheet. Reset guards and bail before any deal/close side effects.
      toast.error("Couldn't save the visit — please try again.");
      setSaving(false);
      savingRef.current = false;
      return;
    }

    if (schedulesFollowUp(disposition) && !alreadyDealCreated) {
      try {
        const followUpDate = customDateStr
          ? new Date(`${customDateStr}T00:00:00Z`).toISOString()
          : calculateFollowUpDate(disposition);
        const { id: dealId } = await createDeal.mutateAsync({
          companyName: merchant.name,
          address: merchant.address,
          industry: merchant.category,
          contactName: merchant.name,
          contactPhone: merchant.phone ?? "",
          stage: "new",
          probability: 20,
          leadSource: "path_dropin",
          notes: notes.trim() || undefined,
        });
        await logActivity.mutateAsync({
          dealId,
          type: "drop_in",
          disposition,
          outcomeNotes: notes.trim(),
          followUpDate,
          voiceNoteUrl: null,
        });
        // Both mutations succeeded — only now is a deal truly created.
        await markDealCreated(merchant.id);
        toast.success(`Deal created for ${merchant.name}`);
        // Known accepted edge: if createDeal succeeds but logActivity throws, an
        // orphan deal exists with no drop-in activity / follow-up. We don't roll
        // back; the visit is recorded and dealCreated stays false, so the summary
        // won't over-count.
      } catch {
        toast.error("Couldn't finish logging — the visit was saved but the deal/follow-up may not have been.");
      }
    } else {
      toast.success(`Visit logged: ${DISPOSITIONS[disposition].label}`);
    }
    setSaving(false);
    savingRef.current = false;
    onLogged?.(disposition);
    onOpenChange(false);
  };

  const handleLog = () => {
    if (!selected) return;
    void commit(selected, selected === "followup_requested" ? customDate : undefined);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-radius-lg bg-surface-default p-5 shadow-card-hover sm:inset-0 sm:bottom-auto sm:top-1/2 sm:max-h-[85dvh] sm:-translate-y-1/2 sm:rounded-radius-lg"
        >
          <div className="pb-3">
            <div className="flex items-center justify-between">
              <Dialog.Title className="text-heading-sm text-text-default">
                Log drop-in · {merchant.name}
              </Dialog.Title>
              <Dialog.Close asChild>
                <button aria-label="Close" className="rounded-radius-sm p-1 text-text-muted hover:text-text-default">
                  <X className="h-5 w-5" aria-hidden />
                </button>
              </Dialog.Close>
            </div>
            <p className="mt-1 text-caption text-text-muted">
              Pick an outcome, add a note, then log the stop.
            </p>
          </div>

          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
            {/* Voice note — Coming soon (disabled placeholder; Phase 2 re-wires). */}
            <div className="rounded-radius-md border border-border-default p-4 opacity-60">
              <div className="flex items-center justify-between">
                <span className="text-caption font-medium text-text-muted">Voice note</span>
                <span className="rounded-radius-full bg-surface-sunken px-2 py-0.5 text-caption font-medium text-text-muted">
                  Coming soon
                </span>
              </div>
              <button
                type="button"
                disabled
                aria-disabled
                className="mt-2 inline-flex cursor-not-allowed items-center gap-2 rounded-radius-md bg-surface-sunken px-4 py-2 text-body-md font-medium text-text-muted"
              >
                <Mic className="h-4 w-4" aria-hidden /> Record a voice note
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {PATH_DISPOSITION_KEYS.map((key) => (
                <DispositionTile
                  key={key}
                  tier={DISPOSITIONS[key].tier}
                  title={DISPOSITIONS[key].label}
                  description={DISPOSITIONS[key].rationale}
                  selected={selected === key}
                  onClick={() => setSelected(key)}
                />
              ))}
            </div>

            {selected === "followup_requested" && (
              <label className="flex flex-col gap-1.5">
                <span className="text-caption font-medium text-text-muted">Follow-up date</span>
                <Input
                  type="date"
                  value={customDate}
                  min={todayISO()}
                  onChange={(e) => setCustomDate(e.target.value)}
                />
              </label>
            )}

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
              className="flex-1"
              disabled={!selected || (selected === "followup_requested" && !customDate) || saving}
              loading={saving}
              onClick={handleLog}
            >
              Log Stop
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default DropInSheet;
