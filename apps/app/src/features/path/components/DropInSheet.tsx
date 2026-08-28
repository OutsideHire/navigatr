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
 * Each outcome tile shows its follow-up timing (outcomeFollowUpMeta): a fixed
 * N-day interval, "You pick the date" for scheduled_callback, or "No follow-up"
 * for the two terminal outcomes. Outcomes drive all future follow-up, so the
 * rep sees up front what each one schedules.
 *
 * "Asked me to come back" (scheduled_callback) reveals a prominent inline date
 * picker (starts empty, min = today) since the owner named a time; selecting it
 * scrolls the picker into view, and "Log Stop" stays disabled until the rep
 * picks the return date, which becomes the follow-up.
 *
 * Notes: an optional dictated note (NotesFieldWithMic), captured on EVERY outcome
 * (stored on path_stops.notes via logVisit) and also forwarded to the deal's
 * drop_in activity for follow-up outcomes. Replaces the old disabled "Voice note
 * Coming soon" audio-memo placeholder (audio memo stays deferred).
 *
 * Places-only: no employee count, estimated value, or email captured.
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CalendarClock, X } from "lucide-react";
import { toast } from "sonner";

import { Button, Input, DispositionTile, NotesFieldWithMic } from "@/components/navigatr";
import { dateOnlyToNoonUtcIso } from "@/lib/calendarDate";
import {
  DISPOSITIONS,
  calculateFollowUpDate,
  schedulesFollowUp,
  type Disposition,
} from "@/lib/followUpScheduling";
import type { Merchant } from "../mockData";
import { useTodayPath } from "../hooks/useTodayPath";
import { PATH_DISPOSITION_KEYS } from "../lib/pathDispositions";
import { repOutcomeLabel, repOutcomeSubtitle } from "../lib/outcomeRepLabels";
import { outcomeFollowUpMeta } from "../lib/outcomeFollowUpMeta";
import { todayISO } from "../lib/today";
import { useCreateDeal, DuplicateDealError } from "@/features/pipeline/hooks/useCreateDeal";
import { useLogActivity } from "@/features/activities/hooks/useLogActivity";
import { useFollowupSync } from "@/features/appointments/useFollowupSync";
import { useProfile } from "@/features/auth/useProfile";

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
  const { syncFollowup } = useFollowupSync();
  // A deal-creating outcome needs the workspace profile (org_id) loaded, or
  // createDeal throws. Mounting the sheet subscribes to the query, so it is
  // usually resolved by the time the rep taps Log Stop; the commit guard below
  // covers the rare fresh-load race.
  const profile = useProfile();
  const profileReady = Boolean(profile.data?.org_id);

  const [selected, setSelected] = React.useState<Disposition | null>(null);
  const [customDate, setCustomDate] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  // Synchronous guard against double-submit: `saving` state is a stale closure
  // within a single tick, so a fast double-tap can fire commit() twice and
  // create two deals before React re-renders. The ref flips immediately.
  const savingRef = React.useRef(false);
  // The date picker renders below the outcome grid; on a phone the grid can
  // fill the sheet, so scroll the picker into view when the rep taps "Asked me
  // to come back" — otherwise it appears off-screen and feels absent.
  const pickerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (selected === "scheduled_callback") {
      pickerRef.current?.scrollIntoView?.({ block: "nearest" });
    }
  }, [selected]);

  // Reset the form each time the sheet opens for a (possibly new) merchant.
  React.useEffect(() => {
    if (open) {
      setSelected(null);
      // Empty, not a pre-filled default: the owner named a time, so the rep must
      // actively pick the return date (Log Stop stays disabled until they do).
      setCustomDate("");
      setNotes("");
      setSaving(false);
      savingRef.current = false;
    }
  }, [open, merchant?.id]);

  if (!merchant) return null;

  const commit = async (disposition: Disposition, customDateStr?: string) => {
    if (!merchant || savingRef.current) return;
    // Deal-creating outcomes need the profile (org_id) loaded first. If it isn't
    // ready yet (a drop-in on a fresh Path load, before useProfile resolves),
    // prompt a retry instead of logging the visit and advancing with no deal.
    // Self-heals: the profile resolves in a beat, so the next tap goes through.
    if (schedulesFollowUp(disposition) && !alreadyDealCreated && !profileReady) {
      toast.info("Just a moment, getting your workspace ready. Try again.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      // Always record the disposition + note on the queue stop (works on every
      // outcome, including dead-ends that create no deal — so the note is kept).
      await logVisit(merchant.id, disposition, notes);
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
          ? dateOnlyToNoonUtcIso(customDateStr)
          : calculateFollowUpDate(disposition);
        const { id: dealId } = await createDeal.mutateAsync({
          companyName: merchant.name,
          address: merchant.address,
          industry: merchant.category,
          contactName: merchant.name,
          contactPhone: merchant.phone ?? "",
          stage: "new",
          probability: 20,
          // System-set source: a Path drop-in. Stamp the canonical value + the
          // originating path so the Lead Source report can trace which route
          // (and its industry mix) actually converts (LS-1).
          leadSource: "path",
          sourcePathId: todayPath.pathId,
          placeId: merchant.placeId,
        });
        await logActivity.mutateAsync({
          dealId,
          type: "drop_in",
          disposition,
          // Carry the drop-in note onto the deal so it shows in the pipeline too.
          outcomeNotes: notes.trim(),
          followUpDate,
          voiceNoteUrl: null,
        });
        // Both mutations succeeded — only now is a deal truly created.
        await markDealCreated(merchant.id);
        // The drop-in log's DB trigger set the new deal's next_followup_at —
        // reconcile its calendar event. Fire-and-forget: never blocks the flow.
        void syncFollowup(dealId);
        toast.success(`Deal created for ${merchant.name}`);
        // Known accepted edge: if createDeal succeeds but logActivity throws, an
        // orphan deal exists with no drop-in activity / follow-up. We don't roll
        // back; the visit is recorded and dealCreated stays false, so the summary
        // won't over-count.
      } catch (err) {
        if (err instanceof DuplicateDealError) {
          // Already in the team's pipeline (org-wide active-deal guard). The
          // visit above is still recorded; we skip creating a duplicate deal.
          toast.info(`${merchant.name} is already in your team's pipeline.`);
        } else {
          toast.error("Couldn't finish logging — the visit was saved but the deal/follow-up may not have been.");
        }
      }
    } else {
      toast.success(`Visit logged: ${repOutcomeLabel(disposition)}`);
    }
    setSaving(false);
    savingRef.current = false;
    onLogged?.(disposition);
    onOpenChange(false);
  };

  const handleLog = () => {
    if (!selected) return;
    void commit(selected, selected === "scheduled_callback" ? customDate : undefined);
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
              Pick an outcome, then log the stop.
            </p>
          </div>

          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
            {/* Optional note — dictate or type. Works on any outcome. Placed
                above the outcomes so a rep can capture what happened first. */}
            <div className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-text-muted">Notes (optional)</span>
              <NotesFieldWithMic
                value={notes}
                onChange={setNotes}
                placeholder="Add a note. Tap Dictate to speak."
                rows={3}
                disabled={saving}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              {PATH_DISPOSITION_KEYS.map((key) => {
                const followUp = outcomeFollowUpMeta(key);
                return (
                  <DispositionTile
                    key={key}
                    tier={DISPOSITIONS[key].tier}
                    title={repOutcomeLabel(key)}
                    description={repOutcomeSubtitle(key)}
                    meta={followUp.label}
                    metaTone={followUp.tone}
                    selected={selected === key}
                    onClick={() => setSelected(key)}
                  />
                );
              })}
            </div>

            {selected === "scheduled_callback" && (
              <div
                ref={pickerRef}
                className="flex flex-col gap-2 rounded-radius-md border border-brand-primary bg-brand-primary-10 p-3"
              >
                <label
                  htmlFor="dropin-return-date"
                  className="flex items-center gap-1.5 text-caption font-medium text-brand-primary"
                >
                  <CalendarClock className="h-4 w-4" aria-hidden />
                  When are you coming back?
                </label>
                <Input
                  id="dropin-return-date"
                  type="date"
                  value={customDate}
                  min={todayISO()}
                  onChange={(e) => setCustomDate(e.target.value)}
                />
                <span className="text-caption text-text-muted">
                  Pick the day the owner asked you to return. Needed before you can log the stop.
                </span>
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-4">
            <Button variant="secondary" onClick={() => onOpenChange(false)} className="flex-1">
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              disabled={!selected || (selected === "scheduled_callback" && !customDate) || saving}
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
