/**
 * DropInSheet — log a field drop-in for a path stop.
 *
 * Tap-to-auto-save: tapping a disposition tile commits immediately and advances
 * to the next stop. There is no Save button; the footer keeps only Cancel.
 *   - always: record the disposition on the queue stop (useTodayPath.logVisit).
 *   - follow-up outcomes (schedulesFollowUp === true): also create a Pipeline
 *     deal (company = business name, contact = business name) and log a
 *     `drop_in` activity whose disposition auto-schedules the follow-up.
 *   - terminal outcomes: log the visit only — no deal.
 *
 * Follow-Up Requested is the one exception: instead of committing on tap, it
 * reveals an inline date picker (default +7 calendar days, min = today) and a
 * "Set follow-up & next" button that commits with the chosen date.
 *
 * Places-only: no employee count, estimated value, or email captured.
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
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
import { useAuth } from "@/stores/auth";
import { useVoiceRecorder } from "../hooks/useVoiceRecorder";
import { VoiceNoteRecorder } from "./VoiceNoteRecorder";
import { uploadVoiceNote } from "../lib/voiceNoteStorage";

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
  /** Fired after a successful save, with the chosen disposition. Lets running
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
  const userId = useAuth((s) => s.user?.id);
  const recorder = useVoiceRecorder();

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
      recorder.reset();
    }
    // recorder.reset is stable; omitting `recorder` avoids re-running on its
    // per-render reference churn while still resetting on every open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, merchant?.id]);

  if (!merchant) return null;

  const commit = async (disposition: Disposition, customDateStr?: string) => {
    if (!merchant || savingRef.current) return;
    const hasRecording = recorder.state === "recorded" && recorder.blob != null;
    if (hasRecording && !schedulesFollowUp(disposition)) {
      if (!window.confirm("No deal is created for this outcome, so the voice note won't be saved. Log it anyway?")) {
        return;
      }
    }
    savingRef.current = true;
    setSaving(true);
    // Always record the disposition on the queue stop.
    await logVisit(merchant.id, disposition);

    if (schedulesFollowUp(disposition) && !alreadyDealCreated) {
      try {
        const followUpDate = customDateStr
          ? new Date(`${customDateStr}T00:00:00Z`).toISOString()
          : calculateFollowUpDate(disposition);
        let voiceNoteUrl: string | null = null;
        if (hasRecording && userId) {
          try {
            voiceNoteUrl = await uploadVoiceNote(recorder.blob!, recorder.mimeType, userId);
          } catch {
            toast.error("Couldn't save the voice note — logging the visit anyway.");
          }
        }
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
          voiceNoteUrl,
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
      toast.success(`Visit logged: ${DISPOSITIONS[disposition].label}`);
    }
    setSaving(false);
    savingRef.current = false;
    onLogged?.(disposition);
    onOpenChange(false);
  };

  // Tap-to-auto-save: most tiles commit immediately. Follow-Up Requested is the
  // exception — it reveals the inline date picker and waits for confirmation.
  const handleSelect = (key: Disposition) => {
    setSelected(key);
    if (key !== "followup_requested") {
      void commit(key);
    }
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
              Tap an outcome — auto-saves and advances to the next stop.
            </p>
          </div>

          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
            <VoiceNoteRecorder
              state={recorder.state}
              durationMs={recorder.durationMs}
              blob={recorder.blob}
              onStart={() => void recorder.start()}
              onStop={recorder.stop}
              onReset={recorder.reset}
            />
            <div className="grid grid-cols-2 gap-2">
              {PATH_DISPOSITION_KEYS.map((key) => (
                <DispositionTile
                  key={key}
                  tier={DISPOSITIONS[key].tier}
                  title={DISPOSITIONS[key].label}
                  description={DISPOSITIONS[key].rationale}
                  selected={selected === key}
                  onClick={() => handleSelect(key)}
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
                <Button
                  variant="primary"
                  className="mt-1 self-start"
                  disabled={!customDate || saving}
                  loading={saving}
                  onClick={() => void commit("followup_requested", customDate)}
                >
                  Set follow-up & next
                </Button>
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
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default DropInSheet;
