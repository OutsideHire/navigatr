/**
 * AppointmentOutcomeSheet, record the outcome of a past-due scheduled
 * appointment (task W2b-2).
 *
 * Mirrors DropInSheet's explicit-commit shape: tapping a tile only selects
 * it, nothing is saved until "Log outcome" is tapped. The 5 primary appt_*
 * outcomes (DISPOSITIONS_BY_TYPE.appointment.top) show up-front; "More"
 * reveals the remaining 4. Selecting "Not interested" reveals a "Do not
 * contact" checkbox, since that combination moves the deal to lost (see
 * useRecordAppointmentOutcome).
 *
 * Non-blocking: a failed submit shows an error toast and keeps the sheet
 * open so the rep can retry without losing the note.
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { toast } from "sonner";

import { Button, Checkbox, FormField, Input, NotesFieldWithMic, DispositionTile } from "@/components/navigatr";
import { DISPOSITIONS, type Disposition } from "@/lib/followUpScheduling";
import { DISPOSITIONS_BY_TYPE } from "@/features/activities/lib/dispositionSets";
import { repOutcomeLabel, repOutcomeSubtitle } from "@/features/path/lib/outcomeRepLabels";
import { useRecordAppointmentOutcome } from "../hooks/useRecordAppointmentOutcome";

const { top: PRIMARY_OUTCOMES, all: ALL_OUTCOMES } = DISPOSITIONS_BY_TYPE.appointment;
const SECONDARY_OUTCOMES = ALL_OUTCOMES.filter((d) => !PRIMARY_OUTCOMES.includes(d));

export interface AppointmentOutcomeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointmentId: string;
  dealId: string;
  merchantName?: string;
  /** True when the deal already has another scheduled appointment, passed
   *  straight through to useRecordAppointmentOutcome. */
  hasFutureAppointment: boolean;
}

export function AppointmentOutcomeSheet({
  open,
  onOpenChange,
  appointmentId,
  dealId,
  merchantName,
  hasFutureAppointment,
}: AppointmentOutcomeSheetProps) {
  const recordOutcome = useRecordAppointmentOutcome();

  const [selected, setSelected] = React.useState<Disposition | null>(null);
  const [showMore, setShowMore] = React.useState(false);
  const [notes, setNotes] = React.useState("");
  const [doNotContact, setDoNotContact] = React.useState(false);
  const [decisionDate, setDecisionDate] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setSelected(null);
      setShowMore(false);
      setNotes("");
      setDoNotContact(false);
      setDecisionDate("");
      setSaving(false);
    }
  }, [open]);

  const handleSelect = (outcome: Disposition) => {
    setSelected(outcome);
    if (outcome !== "appt_not_interested") setDoNotContact(false);
  };

  const handleSubmit = async () => {
    if (!selected || saving) return;
    setSaving(true);
    try {
      await recordOutcome.mutateAsync({
        appointmentId,
        dealId,
        outcome: selected,
        notes: notes.trim() || undefined,
        hasFutureAppointment,
        doNotContact: selected === "appt_not_interested" ? doNotContact : false,
        expectedDecisionDate:
          selected === "appt_presented_awaiting" ? decisionDate || null : null,
      });
      toast.success(`Outcome logged: ${repOutcomeLabel(selected)}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't log the outcome. Please try again.");
    } finally {
      setSaving(false);
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
                {merchantName ? `Appointment outcome · ${merchantName}` : "Appointment outcome"}
              </Dialog.Title>
              <Dialog.Close asChild>
                <button aria-label="Close" className="rounded-radius-sm p-1 text-text-muted hover:text-text-default">
                  <X className="h-5 w-5" aria-hidden />
                </button>
              </Dialog.Close>
            </div>
            <p className="mt-1 text-caption text-text-muted">
              How did the appointment go?
            </p>
          </div>

          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
            <div className="grid grid-cols-2 gap-2">
              {PRIMARY_OUTCOMES.map((key) => (
                <DispositionTile
                  key={key}
                  tier={DISPOSITIONS[key].tier}
                  title={repOutcomeLabel(key)}
                  description={repOutcomeSubtitle(key)}
                  selected={selected === key}
                  onClick={() => handleSelect(key)}
                />
              ))}
            </div>

            {showMore && (
              <div className="grid grid-cols-2 gap-2">
                {SECONDARY_OUTCOMES.map((key) => (
                  <DispositionTile
                    key={key}
                    tier={DISPOSITIONS[key].tier}
                    title={repOutcomeLabel(key)}
                    description={repOutcomeSubtitle(key)}
                    selected={selected === key}
                    onClick={() => handleSelect(key)}
                  />
                ))}
              </div>
            )}

            <Button
              variant="tertiary"
              size="sm"
              trailingIcon={showMore ? ChevronUp : ChevronDown}
              onClick={() => setShowMore((v) => !v)}
              className="self-start"
            >
              {showMore ? "Fewer outcomes" : "More"}
            </Button>

            {selected === "appt_not_interested" && (
              <Checkbox
                label="Do not contact"
                helper="Opts the merchant out and moves the deal to lost."
                checked={doNotContact}
                onCheckedChange={setDoNotContact}
              />
            )}

            {selected === "appt_presented_awaiting" && (
              <FormField
                htmlFor="decisionDate"
                label="Expected decision date"
                helper="Optional. Replaces the 3-day default and pins the follow-up to this date."
              >
                <Input
                  id="decisionDate"
                  type="date"
                  value={decisionDate}
                  onChange={(e) => setDecisionDate(e.target.value)}
                />
              </FormField>
            )}

            <NotesFieldWithMic
              value={notes}
              onChange={setNotes}
              placeholder="What was discussed with the merchant?"
            />
          </div>

          <div className="flex gap-2 pt-4">
            <Button variant="secondary" onClick={() => onOpenChange(false)} className="flex-1">
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              disabled={!selected || saving}
              loading={saving}
              onClick={() => void handleSubmit()}
            >
              Log outcome
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default AppointmentOutcomeSheet;
