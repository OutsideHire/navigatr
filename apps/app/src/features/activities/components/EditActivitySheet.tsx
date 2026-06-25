/**
 * EditActivitySheet — edit a logged call activity, with a manager/admin
 * delete affordance.
 *
 * Sprint 1 ships call-only editing (mirroring LogActivitySheet's CallForm
 * scope): duration, disposition, notes, follow-up date. The disposition
 * change preserves the *current* follow_up_date instead of re-running
 * smart scheduling — once a rep has committed to a date, fixing a typo
 * in the disposition shouldn't silently move their calendar. They can
 * blank the follow-up field if they want it cleared.
 *
 * Delete is gated to manager/admin via useProfile + a two-tap confirm
 * (same UX as EditDealSheet).
 */

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useForm, Controller, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { X, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  Button,
  DispositionTile,
  FormField,
  Input,
  NotesFieldWithMic,
} from "@/components/navigatr";
import { DISPOSITIONS } from "@/lib/followUpScheduling";
import { useUpdateActivity } from "../hooks/useUpdateActivity";
import { useDeleteActivity } from "../hooks/useDeleteActivity";
import { useProfile } from "@/features/auth/useProfile";
import type { Activity } from "../mockData";
import { DISPOSITIONS_BY_TYPE, DISPOSITION_VALUES } from "../lib/dispositionSets";

const emptyToUndefined = (v: unknown) =>
  v === "" || v === null || v === undefined ? undefined : v;

const editSchema = z.object({
  durationMinutes: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive("Enter call duration"),
  ),
  disposition: z.enum(DISPOSITION_VALUES),
  outcomeNotes: z.string().optional(),
  followUpDate: z.string().optional(),
});

type EditActivityValues = z.infer<typeof editSchema>;

export interface EditActivitySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activity: Activity;
}

/** ISO timestamp → YYYY-MM-DD for <input type="date"> */
function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export function EditActivitySheet({ open, onOpenChange, activity }: EditActivitySheetProps) {
  const update = useUpdateActivity();
  const del = useDeleteActivity();
  const profile = useProfile();
  const canDelete =
    profile.data?.role === "manager" || profile.data?.role === "admin";

  const [showAll, setShowAll] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  // Outcome options scoped to this activity's type. If the stored disposition
  // is outside the type's set (legacy / cross-type data), include it so the
  // editor never hides the current value.
  const dispositionSet = DISPOSITIONS_BY_TYPE[activity.type];
  const allOptions = dispositionSet.all.includes(activity.disposition)
    ? dispositionSet.all
    : [activity.disposition, ...dispositionSet.all];
  React.useEffect(() => {
    if (!confirmDelete) return;
    const t = window.setTimeout(() => setConfirmDelete(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirmDelete]);

  const defaultValues = React.useMemo<EditActivityValues>(
    () => ({
      durationMinutes: (activity.durationMinutes ?? "") as unknown as number,
      disposition: activity.disposition,
      outcomeNotes: activity.outcomeNotes ?? "",
      followUpDate: toDateInput(activity.followUpDate),
    }),
    [activity],
  );

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<EditActivityValues>({
    resolver: zodResolver(editSchema),
    defaultValues,
    mode: "onBlur",
  });

  React.useEffect(() => {
    if (open) {
      reset(defaultValues);
      setShowAll(
        // If the current disposition isn't in the type's top tiles, expand
        // the picker so the user can see what they're editing.
        !dispositionSet.top.includes(activity.disposition),
      );
      setConfirmDelete(false);
    }
  }, [open, defaultValues, reset, activity.disposition]);

  const onSubmit: SubmitHandler<EditActivityValues> = async (values) => {
    const patch: Parameters<typeof update.mutateAsync>[0]["patch"] = {};
    if (dirtyFields.durationMinutes) {
      patch.durationMinutes = Number(values.durationMinutes);
    }
    if (dirtyFields.disposition) patch.disposition = values.disposition;
    if (dirtyFields.outcomeNotes) patch.outcomeNotes = values.outcomeNotes ?? "";
    if (dirtyFields.followUpDate) {
      patch.followUpDate = values.followUpDate
        ? new Date(values.followUpDate + "T00:00:00Z").toISOString()
        : null;
    }

    if (Object.keys(patch).length === 0) {
      toast("No changes to save");
      onOpenChange(false);
      return;
    }

    try {
      await update.mutateAsync({ id: activity.id, dealId: activity.dealId, patch });
      toast.success("Activity updated");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save changes");
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await del.mutateAsync({ id: activity.id, dealId: activity.dealId });
      toast.success("Activity deleted");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete activity");
      setConfirmDelete(false);
    }
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
              Edit activity
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

          <form
            id="edit-activity-form"
            onSubmit={handleSubmit(onSubmit)}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-4"
            noValidate
          >
            <div className="flex flex-col gap-5">
              <FormField
                htmlFor="durationMinutes"
                label="Duration"
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

              <Controller
                control={control}
                name="disposition"
                render={({ field }) => (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-body-strong text-text-default">Outcome</span>
                      <span className="text-caption text-text-muted">
                        Changing this won&apos;t move the follow-up date — edit that below if needed.
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {(showAll ? allOptions : dispositionSet.top).map((d) => {
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
                      {showAll
                        ? `Show top ${dispositionSet.top.length} dispositions`
                        : `Show all ${allOptions.length} dispositions`}
                    </Button>

                    {errors.disposition && (
                      <span className="text-caption text-status-danger">
                        Pick an outcome
                      </span>
                    )}
                  </div>
                )}
              />

              <FormField
                htmlFor="followUpDate"
                label="Follow-up date"
                helper="Leave blank to clear"
              >
                <Input id="followUpDate" type="date" {...register("followUpDate")} />
              </FormField>

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

          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border-subtle bg-surface-default px-5 py-3">
            <div>
              {canDelete && (
                <Button
                  type="button"
                  variant="tertiary"
                  size="md"
                  leadingIcon={Trash2}
                  loading={del.isPending}
                  onClick={handleDelete}
                  className={cn(
                    confirmDelete
                      ? "text-status-danger hover:text-status-danger"
                      : "text-text-muted",
                  )}
                >
                  {confirmDelete ? "Tap again to confirm" : "Delete"}
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Dialog.Close asChild>
                <Button type="button" variant="tertiary" size="md">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button
                type="submit"
                form="edit-activity-form"
                variant="primary"
                size="lg"
                loading={isSubmitting}
              >
                Save changes
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default EditActivitySheet;
