/**
 * LogActivitySheet — the second-biggest form in navigatr.
 *
 * Source: Figma `navigatr v1` Activity Logging master frame —
 * Call variant × {mobile bottom sheet, desktop centered modal}.
 *
 * Sprint 1 ships Call only. Email / Drop-In / Appointment tiles are
 * shown in the type picker but toast "Coming in sprint 2" on tap.
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

const TOP_DISPOSITIONS: Disposition[] = [
  "statement_secured",
  "positive_engagement",
  "dm_unavailable",
  "not_interested",
];

const ALL_DISPOSITIONS: Disposition[] = [
  "statement_secured",
  "positive_engagement",
  "connected_with_dm",
  "dm_unavailable",
  "followup_requested",
  "future_potential",
  "low_probability",
  "not_interested",
  "wrong_number",
  "closed_lost",
];

const emptyToUndefined = (v: unknown) =>
  v === "" || v === null || v === undefined ? undefined : v;

const callSchema = z.object({
  durationMinutes: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive("Enter call duration"),
  ),
  disposition: z.enum([
    "statement_secured",
    "positive_engagement",
    "connected_with_dm",
    "dm_unavailable",
    "followup_requested",
    "future_potential",
    "low_probability",
    "not_interested",
    "wrong_number",
    "closed_lost",
  ]),
  outcomeNotes: z.string().optional(),
});
type CallFormValues = z.infer<typeof callSchema>;

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

function CallForm({
  dealId,
  onLogged,
  onBack,
  onClose,
}: {
  dealId: string;
  onLogged: () => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const [showAll, setShowAll] = React.useState(false);
  const logActivity = useLogActivity();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<CallFormValues>({
    resolver: zodResolver(callSchema),
    defaultValues: {
      // Empty-string default so the "0" placeholder shows; the schema's
      // preprocess turns "" into undefined → "Enter call duration" on submit.
      durationMinutes: "" as unknown as number,
      disposition: undefined,
      outcomeNotes: "",
    },
    mode: "onBlur",
  });

  const onSubmit: SubmitHandler<CallFormValues> = async (values) => {
    const followUpIso = calculateFollowUpDate(values.disposition);
    try {
      await logActivity.mutateAsync({
        dealId,
        type: "call",
        disposition: values.disposition,
        durationMinutes: values.durationMinutes,
        outcomeNotes: values.outcomeNotes ?? "",
        occurredAt: new Date().toISOString(),
        followUpDate: followUpIso,
      });
      if (followUpIso) {
        toast.success(`Activity logged. Follow-up: ${formatFollowUpDate(followUpIso)}`);
      } else {
        toast.success("Activity logged. No follow-up scheduled.");
      }
      onLogged();
      onClose();
    } catch (err) {
      // RLS denial / network failure / org mismatch — surface raw message.
      // We do NOT close the sheet so the rep can retry without re-entering.
      toast.error(err instanceof Error ? err.message : "Could not log activity");
    }
  };

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
            <h2 className="text-body-strong text-text-default">Log call</h2>
            <Button type="button" variant="tertiary" size="sm" onClick={onBack}>
              Change type
            </Button>
          </div>

          {/* Duration */}
          <FormField
            htmlFor="durationMinutes"
            label="Duration"
            helper="In minutes — pre-fill from call log if available"
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
                  {(showAll ? ALL_DISPOSITIONS : TOP_DISPOSITIONS).map((d) => {
                    const spec = DISPOSITIONS[d];
                    return (
                      <DispositionTile
                        key={d}
                        tier={spec.tier}
                        title={spec.label}
                        description={spec.rationale}
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
                  {showAll ? "Show top 4 dispositions" : "Show all 10 dispositions"}
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
                  placeholder="What happened on this call..."
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
  /** Called after a successful log so the parent can refresh activities. */
  onLogged?: () => void;
}

export function LogActivitySheet({
  open,
  onOpenChange,
  dealId,
  onLogged,
}: LogActivitySheetProps) {
  const [type, setType] = React.useState<ActivityType | null>(null);

  // Reset on close so reopening starts at the type picker.
  React.useEffect(() => {
    if (!open) setType(null);
  }, [open]);

  const handleTypeSelect = (t: ActivityType) => {
    if (t === "call") {
      setType("call");
      return;
    }
    toast(
      t === "email" ? "Email logging lands in sprint 2" :
      t === "drop_in" ? "Drop-In logging lands in sprint 2" :
      "Appointment logging lands in sprint 2",
    );
  };

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
              {type === "call" ? "Log activity" : "What did you do?"}
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

          {type === "call" ? (
            <CallForm
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
