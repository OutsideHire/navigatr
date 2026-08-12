/**
 * LogActivitySheet — the second-biggest form in navigatr.
 *
 * Source: Figma `navigatr v1` Activity Logging master frame —
 * Call variant × {mobile bottom sheet, desktop centered modal}.
 *
 * All four activity types (Call / Email / Drop-In / Appointment) share
 * one form. The only per-type difference is whether duration is asked:
 *   call / appointment   → duration_minutes required (it's a length of time)
 *   email / drop_in      → duration omitted (these are point-in-time events)
 *
 * Disposition + outcome notes are shared across all types because the
 * smart follow-up calculator works on disposition alone (a "positive
 * engagement" reschedules in 3 business days whether you got there by
 * phone, email, or footwork).
 *
 * The smart follow-up preview is the differentiator made visible: as
 * soon as the rep picks a disposition, the sheet shows the calculated
 * follow-up date and the rationale. That removes guesswork.
 */

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useForm, Controller, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  Mail,
  MapPin,
  Phone,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  Button,
  Card,
  DispositionTile,
  FormField,
  Input,
  NotesFieldWithMic,
} from "@/components/navigatr";
import {
  calculateFollowUpDate,
  DISPOSITIONS,
  formatFollowUpDate,
  type Disposition,
} from "@/lib/followUpScheduling";
import { type ActivityType } from "../mockData";
import { useLogActivity } from "../hooks/useLogActivity";
import { useFollowupSync } from "@/features/appointments/useFollowupSync";
import { DISPOSITIONS_BY_TYPE, DISPOSITION_VALUES } from "../lib/dispositionSets";
import { formatLogConfirmation } from "../lib/logConfirmation";
import { friendlyLogError } from "../lib/friendlyLogError";
import { repOutcomeLabel, repOutcomeSubtitle } from "@/features/path/lib/outcomeRepLabels";

// ───────────────────────────────────────────────────────────────────────
// Type picker
// ───────────────────────────────────────────────────────────────────────

const TYPE_TILES: Array<{
  type: ActivityType;
  label: string;
  icon: typeof Phone;
  /** alpha-baked-20 surface + full-saturation foreground */
  accentBg: string;
  accentFg: string;
}> = [
  { type: "email",       label: "Email",       icon: Mail,     accentBg: "bg-accent-blue-20",   accentFg: "text-accent-blue"   },
  { type: "call",        label: "Call",        icon: Phone,    accentBg: "bg-accent-teal-20",   accentFg: "text-accent-teal"   },
  { type: "drop_in",     label: "Drop-In",     icon: MapPin,   accentBg: "bg-accent-violet-20", accentFg: "text-accent-violet" },
  { type: "appointment", label: "Appointment", icon: Calendar, accentBg: "bg-accent-orange-20", accentFg: "text-accent-orange" },
];

function TypePicker({
  selected,
  onSelect,
}: {
  selected: ActivityType | null;
  onSelect: (t: ActivityType) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {TYPE_TILES.map((tile) => {
        const isActive = selected === tile.type;
        return (
          <Card
            key={tile.type}
            padding="md"
            onClick={() => onSelect(tile.type)}
            className={cn(
              "flex flex-col items-start gap-3 transition-colors",
              isActive
                ? "border-2 border-brand-primary bg-brand-primary-10"
                : "border border-border-subtle hover:bg-surface-sunken",
            )}
          >
            <span
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-radius-full",
                tile.accentBg,
                tile.accentFg,
              )}
              aria-hidden
            >
              <tile.icon className="h-5 w-5" />
            </span>
            <span className="text-body-strong text-text-default">{tile.label}</span>
          </Card>
        );
      })}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Call form (Sprint 1's only fully-implemented type)
// ───────────────────────────────────────────────────────────────────────

const emptyToUndefined = (v: unknown) =>
  v === "" || v === null || v === undefined ? undefined : v;

// Two schemas because the duration field's validation rules differ. Call /
// Appointment require a positive integer; Email / Drop-In skip duration
// entirely (logged-by-the-trigger schema column is nullable so any value
// is forwarded as null). Both schemas resolve to the same FormValues shape
// so the form body doesn't need to branch on type.
const schemaWithDuration = z.object({
  durationMinutes: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive("Enter duration"),
  ),
  disposition: z.enum(DISPOSITION_VALUES),
  outcomeNotes: z.string().optional(),
});

const schemaNoDuration = z.object({
  // Field stays in the shape so onSubmit can treat values uniformly, but
  // it's optional + ignored when serializing for these types.
  durationMinutes: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
  disposition: z.enum(DISPOSITION_VALUES),
  outcomeNotes: z.string().optional(),
});

type FormValues = z.infer<typeof schemaWithDuration>;

/** Per-type config: does this type ask for duration, and what's the label? */
const TYPE_CONFIG: Record<ActivityType, { needsDuration: boolean; verb: string; durationLabel: string; notesPlaceholder: string }> = {
  call: {
    needsDuration: true,
    verb: "call",
    durationLabel: "Duration",
    notesPlaceholder: "What happened on this call...",
  },
  appointment: {
    needsDuration: true,
    verb: "appointment",
    durationLabel: "Length",
    notesPlaceholder: "What was discussed in the meeting...",
  },
  email: {
    needsDuration: false,
    verb: "email",
    durationLabel: "",
    notesPlaceholder: "Subject line + what was sent or received...",
  },
  drop_in: {
    needsDuration: false,
    verb: "drop-in",
    durationLabel: "",
    notesPlaceholder: "Who you met with, what you saw...",
  },
};

function FollowUpPreview({ disposition }: { disposition: Disposition }) {
  const spec = DISPOSITIONS[disposition];
  const iso = calculateFollowUpDate(disposition);

  if (!iso) {
    return (
      <Card padding="md" className="bg-surface-sunken">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-radius-full bg-text-subtle/15 text-text-muted">
            <Calendar className="h-4 w-4" aria-hidden />
          </span>
          <div className="flex flex-col gap-0.5">
            <p className="text-body-strong text-text-default">No follow-up scheduled</p>
            <p className="text-caption text-text-muted">
              {spec.label} · {spec.rationale}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  // Tint by tier — same palette as the disposition band.
  const tierBg: Record<typeof spec.tier, string> = {
    positive: "bg-status-success-bg",
    neutral:  "bg-status-warning-bg",
    cool:     "bg-accent-blue-20",
    negative: "bg-status-danger-bg",
  };
  const tierFg: Record<typeof spec.tier, string> = {
    positive: "text-status-success",
    neutral:  "text-status-warning",
    cool:     "text-accent-blue",
    negative: "text-status-danger",
  };

  return (
    <Card padding="md" className={tierBg[spec.tier]}>
      <div className="flex items-start gap-3">
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-radius-full bg-surface-default", tierFg[spec.tier])}>
          <Calendar className="h-4 w-4" aria-hidden />
        </span>
        <div className="flex flex-col gap-0.5">
          <p className="text-body-strong text-text-default">
            Smart follow-up scheduled for {formatFollowUpDate(iso)}
          </p>
          <p className="text-caption text-text-muted">
            {spec.businessDays} business {spec.businessDays === 1 ? "day" : "days"} from today, per {spec.label}
          </p>
        </div>
      </div>
    </Card>
  );
}

function ActivityForm({
  type,
  dealId,
  onLogged,
  onBack,
  onClose,
}: {
  type: ActivityType;
  dealId: string;
  onLogged: (activityId: string) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const [showAll, setShowAll] = React.useState(false);
  const logActivity = useLogActivity();
  const { syncFollowup } = useFollowupSync();
  const cfg = TYPE_CONFIG[type];
  const dispositionSet = DISPOSITIONS_BY_TYPE[type];

  // SP2 capture steps: a promised callback date/time and a verbal-commitment
  // next-step. Kept as local state (not RHF) since they're conditional on the
  // selected outcome and validated inline at submit.
  const [callbackAt, setCallbackAt] = React.useState("");
  const [nextStep, setNextStep] = React.useState("");
  const [captureError, setCaptureError] = React.useState<string | null>(null);

  // Post-log confirmation, held inline so the rep sees what the platform did
  // (which follow-up task[s] it created, any record change) right where they're
  // looking, instead of relying only on the corner toast. Set on success; the
  // sheet then auto-closes after a short beat.
  const [confirmed, setConfirmed] = React.useState<{ title: string; lines: string[] } | null>(null);

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(cfg.needsDuration ? schemaWithDuration : schemaNoDuration),
    defaultValues: {
      // Empty-string default so the "0" placeholder shows; the schema's
      // preprocess turns "" into undefined → "Enter duration" on submit.
      durationMinutes: "" as unknown as number,
      disposition: undefined,
      outcomeNotes: "",
    },
    mode: "onBlur",
  });

  const onSubmit: SubmitHandler<FormValues> = async (values) => {
    setCaptureError(null);
    // Callback pins the promised date/time (asserted); it has no interval, so
    // the captured date IS the follow-up.
    const isCallback = values.disposition === "callback";
    if (isCallback && !callbackAt) {
      setCaptureError("Enter the promised callback date and time.");
      return;
    }
    const followUpIso = isCallback ? callbackAt : calculateFollowUpDate(values.disposition);
    try {
      const { id, confirmation } = await logActivity.mutateAsync({
        dealId,
        type,
        disposition: values.disposition,
        // Email + Drop-In don't track duration — send null. The DB column
        // is nullable and the consistency trigger doesn't care.
        durationMinutes: cfg.needsDuration ? values.durationMinutes : null,
        outcomeNotes: values.outcomeNotes ?? "",
        occurredAt: new Date().toISOString(),
        followUpDate: followUpIso,
        followUpDateSource: isCallback ? "asserted" : "interval",
        // Verbal commitment's next step becomes the To-do title.
        taskTitle: values.disposition === "verbal_commitment" ? nextStep.trim() || undefined : undefined,
      });
      // The log's DB trigger has moved the deal's next_followup_at — reconcile
      // its calendar event. Fire-and-forget: never blocks or fails the log.
      void syncFollowup(dealId);
      // Parent refreshes its activity list immediately.
      onLogged(id);
      // Post-log confirmation (Screen Content Spec §5): tell the rep what the
      // platform just did (which task[s] it created or none, and any
      // record-state change), not just that "something" happened. Render it
      // inline in the rep's focus (the corner toast alone was not noticeable),
      // then hold the sheet open a beat before it closes.
      const { title, lines } = formatLogConfirmation(confirmation);
      setConfirmed({ title, lines });
      toast.success(title, { description: lines.join("\n"), duration: 8000 });
      // The delayed auto-close is driven by an effect keyed on `confirmed`
      // (below), so a manually-closed or reopened sheet can cancel a pending
      // timer instead of letting a stale one fire onClose().
    } catch (err) {
      // Network failure, or the deal is no longer in the workspace (FK / RLS /
      // org mismatch on stale sample data). Map the latter to a clear, actionable
      // line instead of a generic failure. We do NOT close the sheet so the rep
      // can retry (or close and dismiss the dead row) without re-entering.
      toast.error(friendlyLogError(err));
    }
  };

  // Delayed auto-close: once the confirmation panel is showing, hold it a beat
  // then close the sheet. Driven from an effect (not an inline setTimeout in
  // the submit handler) so the timer is owned by React's lifecycle: the
  // cleanup clears it if the sheet is closed manually or reopened before it
  // fires, preventing a stale timer from closing a freshly-reopened sheet.
  // The `!confirmed` guard means it never fires on mount (confirmed is null).
  React.useEffect(() => {
    if (!confirmed) return;
    const timer = window.setTimeout(() => onClose(), 2600);
    return () => window.clearTimeout(timer);
  }, [confirmed, onClose]);

  // Success state: the inline confirmation panel replaces the form so the
  // "what the platform just did" message lands squarely in the rep's focus.
  if (confirmed) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-6 pt-2">
        <div
          role="status"
          aria-live="polite"
          className="rounded-radius-lg bg-status-success-bg p-5"
        >
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-radius-full bg-surface-default text-status-success">
              <Check className="h-5 w-5" aria-hidden />
            </span>
            <div className="flex flex-col gap-1">
              <p className="text-body-strong text-status-success">{confirmed.title}</p>
              {confirmed.lines.map((line, i) => (
                <p key={i} className="text-caption text-text-default">
                  {line}
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <form
        id="log-activity-form"
        onSubmit={handleSubmit(onSubmit)}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-4"
        noValidate
      >
        <div className="flex flex-col gap-5">
          {/* Header row inside scroll body so it scrolls with content */}
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-body-strong text-text-default">Log {cfg.verb}</h2>
            <Button type="button" variant="tertiary" size="sm" onClick={onBack}>
              Change type
            </Button>
          </div>

          {/* Duration — call + appointment only. Email + Drop-In are
              point-in-time events; asking for "duration: 0 min" reads as
              a data-entry burden, not insight. */}
          {cfg.needsDuration && (
            <FormField
              htmlFor="durationMinutes"
              label={cfg.durationLabel}
              helper="In minutes"
              error={errors.durationMinutes?.message}
            >
              <Input
                id="durationMinutes"
                type="number"
                suffix="min"
                placeholder="0"
                {...register("durationMinutes")}
              />
            </FormField>
          )}

          {/* Disposition */}
          <Controller
            control={control}
            name="disposition"
            render={({ field }) => (
              <div className="flex flex-col gap-2">
                <div className="flex flex-col gap-0.5">
                  <span className="text-body-strong text-text-default">Outcome</span>
                  <span className="text-caption text-text-muted">Determines follow-up timing</span>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {(showAll ? dispositionSet.all : dispositionSet.top).map((d) => {
                    const spec = DISPOSITIONS[d];
                    return (
                      <DispositionTile
                        key={d}
                        tier={spec.tier}
                        title={repOutcomeLabel(d)}
                        description={repOutcomeSubtitle(d)}
                        selected={field.value === d}
                        onClick={() => field.onChange(d)}
                      />
                    );
                  })}
                </div>

                <Button
                  type="button"
                  variant="tertiary"
                  size="sm"
                  trailingIcon={showAll ? ChevronUp : ChevronDown}
                  onClick={() => setShowAll((v) => !v)}
                  className="self-start"
                >
                  {showAll
                    ? `Show top ${dispositionSet.top.length} dispositions`
                    : `Show all ${dispositionSet.all.length} dispositions`}
                </Button>

                {errors.disposition && (
                  <span className="text-caption text-status-danger">
                    Pick an outcome to schedule the follow-up
                  </span>
                )}

                {/* Smart follow-up preview — only after a disposition is picked. */}
                {field.value && <FollowUpPreview disposition={field.value} />}
              </div>
            )}
          />

          {/* SP2 capture steps — conditional on the selected outcome. */}
          {watch("disposition") === "callback" && (
            <FormField
              htmlFor="callbackAt"
              label="Promised callback"
              helper="The date and time you agreed to call back"
              error={captureError ?? undefined}
            >
              <Input
                id="callbackAt"
                type="datetime-local"
                value={callbackAt}
                onChange={(e) => setCallbackAt(e.target.value)}
              />
            </FormField>
          )}
          {watch("disposition") === "verbal_commitment" && (
            <FormField htmlFor="nextStep" label="Next step" helper="Becomes the follow-up task title">
              <Input
                id="nextStep"
                placeholder="e.g. Prepare the application"
                value={nextStep}
                onChange={(e) => setNextStep(e.target.value)}
              />
            </FormField>
          )}

          {/* Notes */}
          <Controller
            control={control}
            name="outcomeNotes"
            render={({ field }) => (
              <FormField htmlFor="outcomeNotes" label="Notes">
                <NotesFieldWithMic
                  id="outcomeNotes"
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  placeholder={cfg.notesPlaceholder}
                />
              </FormField>
            )}
          />
        </div>
      </form>

      {/* Sticky footer */}
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border-subtle bg-surface-default px-5 py-3">
        <Dialog.Close asChild>
          <Button type="button" variant="tertiary" size="md">Cancel</Button>
        </Dialog.Close>
        <Button
          type="submit"
          form="log-activity-form"
          variant="primary"
          size="lg"
          loading={isSubmitting}
        >
          Log activity
        </Button>
      </div>
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Sheet shell — single Radix Dialog, responsive positioning
// ───────────────────────────────────────────────────────────────────────

export interface LogActivitySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  /**
   * Called after a successful log so the parent can refresh activities.
   * Receives the new activity's id (e.g. so the caller can stamp an
   * explicit coverage-signal match). Callers that don't need it may pass a
   * `() => void` (a wider callback slot always accepts a narrower one).
   */
  onLogged?: (activityId: string) => void;
  /** Open straight onto this type's form, skipping the picker. */
  defaultType?: ActivityType;
}

export function LogActivitySheet({
  open,
  onOpenChange,
  dealId,
  onLogged,
  defaultType,
}: LogActivitySheetProps) {
  const [type, setType] = React.useState<ActivityType | null>(defaultType ?? null);

  // Reset on close so reopening starts where the caller asked (picker or a type).
  React.useEffect(() => {
    if (!open) setType(defaultType ?? null);
  }, [open, defaultType]);

  // All four types route to the shared ActivityForm; duration field is
  // gated per-type via TYPE_CONFIG.
  const handleTypeSelect = (t: ActivityType) => setType(t);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            "fixed inset-0 z-40 bg-black/40",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          )}
        />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "fixed z-50 flex flex-col bg-surface-default text-text-default shadow-card-hover",
            "inset-x-0 bottom-0 max-h-[90dvh] rounded-t-radius-lg",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-[560px] sm:-translate-x-1/2 sm:-translate-y-1/2",
            "sm:rounded-radius-lg sm:max-h-[80vh]",
            "sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:zoom-out-95",
            "sm:data-[state=open]:fade-in-0 sm:data-[state=closed]:fade-out-0",
            "sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=closed]:slide-out-to-bottom-0",
          )}
        >
          <div className="flex shrink-0 justify-center pt-2 sm:hidden" aria-hidden>
            <div className="h-1 w-10 rounded-radius-full bg-border-default" />
          </div>

          <div className="flex shrink-0 items-center justify-between gap-2 px-5 pb-3 pt-3 sm:pt-5">
            <Dialog.Title className="text-heading-sm text-text-default">
              {type ? "Log activity" : "What did you do?"}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="inline-flex h-8 w-8 items-center justify-center rounded-radius-sm text-text-muted hover:bg-surface-sunken hover:text-text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
              >
                <X className="h-5 w-5" />
              </button>
            </Dialog.Close>
          </div>

          {type ? (
            <ActivityForm
              type={type}
              dealId={dealId}
              onLogged={onLogged ?? (() => {})}
              onBack={() => setType(null)}
              onClose={() => onOpenChange(false)}
            />
          ) : (
            <div className="px-5 pb-5">
              <TypePicker selected={type} onSelect={handleTypeSelect} />
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default LogActivitySheet;
