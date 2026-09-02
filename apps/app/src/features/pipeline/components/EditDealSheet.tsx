/**
 * EditDealSheet — sibling of AddDealSheet for the existing-deal edit flow.
 *
 * Scope: the fields on the cached `Deal` shape (companyName, address, contact,
 * value, probability, stage, expected close / nextFollowupAt, lead source,
 * employee count range). Editing the address re-geocodes the deal for Path via
 * useUpdateDeal (Places deals keep their Google coords). Notes / industry /
 * contactTitle aren't on the cached Deal type yet; they'll land when useDeals'
 * SELECT grows.
 *
 * Delete affordance lives in the footer, gated to manager/admin via
 * useProfile. Two-tap confirm so a misclick on mobile doesn't nuke a
 * deal — first tap arms the button, second tap fires the mutation.
 *
 * Same responsive shell as AddDealSheet: bottom sheet on mobile, centered
 * modal on desktop.
 */

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as RadioGroup from "@radix-ui/react-radio-group";
import { useForm, Controller, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { REP_SOURCE_OPTIONS, isLeadSourceEditable, leadSourceLabel, leadSourceSetBy } from "../lib/leadSources";
import { z } from "zod";
import { AsYouType } from "libphonenumber-js";
import { X, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { dateOnlyToNoonUtcIso } from "@/lib/calendarDate";
import {
  Button,
  FormField,
  Input,
  NotesFieldWithMic,
  Select,
  type SelectOption,
} from "@/components/navigatr";
import { useUpdateDeal } from "../hooks/useUpdateDeal";
import { useDeleteDeal } from "../hooks/useDeleteDeal";
import { useProfile } from "@/features/auth/useProfile";
import {
  type Deal,
  type DealStage,
  type LostReasonCategory,
  LOST_REASON_LABEL,
} from "../mockData";

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}
function formatUSPhone(input: string): string {
  const d = digitsOnly(input);
  if (d.length === 0) return "";
  return new AsYouType("US").input(d.slice(0, d.startsWith("1") ? 11 : 10));
}
/** Stored phones are E.164 ("+15555555555"). The Zod validator wants 10
 *  digits exactly; pre-filling "1 (555) 555-5555" would fail validation
 *  and force the rep to re-type the phone every time they hit Save. Strip
 *  the leading country code so the form sees a clean 10-digit value. */
function stripUsCountryCode(phone: string): string {
  const d = digitsOnly(phone);
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}
const emptyToUndefined = (v: unknown) =>
  v === "" || v === null || v === undefined ? undefined : v;

const STAGE_OPTIONS: SelectOption[] = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "proposal", label: "Proposal" },
  { value: "submitted", label: "Negotiation" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

const EMPLOYEE_COUNT_OPTIONS: SelectOption[] = [
  { value: "1-9", label: "1-9" },
  { value: "10-49", label: "10-49" },
  { value: "50-249", label: "50-249" },
  { value: "250+", label: "250+" },
];

const editSchema = z.object({
  companyName: z.string().min(1, "Company name is required"),
  // Optional street address. Empty clears it; a change re-geocodes the deal for
  // Path (useUpdateDeal), except Places-created deals keep their Google coords.
  address: z.string().optional(),
  contactName: z.string().min(1, "Contact name is required"),
  // Optional: an empty string clears the email; a non-empty value must be a
  // valid email. Email is not required on a deal (Path QA D).
  contactEmail: z.string().email("Enter a valid email").optional().or(z.literal("")),
  contactPhone: z
    .string()
    .min(1, "Phone is required")
    .refine((v) => digitsOnly(v).length === 10, "Enter a 10-digit US phone"),
  dealValue: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive("Enter a deal value"),
  ),
  stage: z.enum(["new", "contacted", "qualified", "proposal", "submitted", "won", "lost"]),
  probability: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).max(100),
  ),
  expectedClose: z.string().optional(),
  leadSource: z.string().optional(),
  leadSourceNote: z.string().max(500).optional(),
  employeeCountRange: z.string().optional(),
  lostReasonCategory: z
    .enum(["price", "competitor", "timing", "no_decision", "incumbent", "unqualified", "other"])
    .nullable()
    .optional(),
  lostReasonNotes: z.string().max(500).nullable().optional(),
}).superRefine((data, ctx) => {
  if (data.stage === "lost" && !data.lostReasonCategory) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Pick a reason for the loss.",
      path: ["lostReasonCategory"],
    });
  }
  if (data.leadSource === "other" && !data.leadSourceNote?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Add a note for Other", path: ["leadSourceNote"] });
  }
});

export type EditDealValues = z.infer<typeof editSchema>;

export interface EditDealSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal: Deal;
  /** Called after a successful delete so the host can navigate away. */
  onDeleted?: () => void;
}

/** Convert nextFollowup (ISO timestamp) to a YYYY-MM-DD value for <input type="date"> */
function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  // Use the UTC date portion to avoid timezone drift on round-trip.
  return iso.slice(0, 10);
}

export function EditDealSheet({ open, onOpenChange, deal, onDeleted }: EditDealSheetProps) {
  const update = useUpdateDeal();
  const del = useDeleteDeal();
  const profile = useProfile();
  const canDelete =
    profile.data?.role === "manager" || profile.data?.role === "admin";

  // Two-tap delete confirm. First click arms; second within ~4s fires.
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  React.useEffect(() => {
    if (!confirmDelete) return;
    const t = window.setTimeout(() => setConfirmDelete(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirmDelete]);

  const defaultValues = React.useMemo<EditDealValues>(
    () => ({
      companyName: deal.companyName,
      address: deal.address ?? "",
      contactName: deal.contactName,
      contactEmail: deal.email,
      contactPhone: formatUSPhone(stripUsCountryCode(deal.phone)),
      dealValue: Math.round(deal.valueCents / 100) as unknown as number,
      stage: deal.stage,
      probability: deal.probability,
      expectedClose: toDateInput(deal.nextFollowup),
      leadSource: deal.leadSource || undefined,
      leadSourceNote: deal.leadSourceNote ?? undefined,
      employeeCountRange: deal.employeeCountRange || undefined,
      lostReasonCategory: deal.lostReasonCategory ?? null,
      lostReasonNotes: deal.lostReasonNotes ?? null,
    }),
    [deal],
  );

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<EditDealValues>({
    resolver: zodResolver(editSchema),
    defaultValues,
    mode: "onBlur",
  });

  // Re-seed ONLY on the open transition (closed -> open), not on every
  // `deal` reference change. useDeal derives the deal via deals.find() on
  // the React Query cache, so a background refetch (window refocus, cache
  // invalidation) hands us a fresh `deal` object with identical data. If we
  // reset on that, we wipe the rep's in-progress edits (and the dirty-field
  // baseline), so a typed email/phone silently reverts before Save. Guarding
  // on the transition keeps edits intact while still seeding fresh when the
  // sheet opens for a (possibly different) deal.
  const wasOpen = React.useRef(false);
  React.useEffect(() => {
    if (open && !wasOpen.current) reset(defaultValues);
    wasOpen.current = open;
  }, [open, defaultValues, reset]);

  const watchedStage = watch("stage");
  const showLostReason = watchedStage === "lost";

  const onSubmit: SubmitHandler<EditDealValues> = async (values) => {
    // Build a patch of ONLY dirty fields so we don't write back unchanged
    // columns. Keeps the deal_stage_history trigger from being noisy and
    // makes a value-only edit a one-column UPDATE.
    const patch: Parameters<typeof update.mutateAsync>[0]["patch"] = {};
    if (dirtyFields.companyName) patch.companyName = values.companyName;
    if (dirtyFields.address) {
      // Empty clears the address (send null, never ""); a change re-geocodes.
      // dirtyFields is computed on the RAW value, so a whitespace-only edit can
      // look dirty while the trimmed value is unchanged; only send (and thus
      // re-geocode) when the trimmed value actually differs from the stored one.
      const nextAddress = values.address?.trim() ? values.address.trim() : null;
      if (nextAddress !== (deal.address ?? null)) patch.address = nextAddress;
    }
    if (dirtyFields.contactName) patch.contactName = values.contactName;
    if (dirtyFields.contactEmail) {
      // Empty clears the email (send null, never ""), otherwise the typed value.
      patch.contactEmail = values.contactEmail?.trim() ? values.contactEmail : null;
    }
    if (dirtyFields.contactPhone) {
      patch.contactPhone = "+1" + digitsOnly(values.contactPhone);
    }
    if (dirtyFields.dealValue) {
      patch.valueCents = Math.round(Number(values.dealValue) * 100);
    }
    if (dirtyFields.stage) patch.stage = values.stage;
    if (dirtyFields.probability) {
      patch.probability = Number(values.probability);
    }
    if (dirtyFields.expectedClose) {
      patch.expectedClose = values.expectedClose || null;
      // Mirror to next_followup_at so the dashboard's follow-up signals stay
      // in sync — same convention AddDealSheet uses: noon UTC of the picked
      // calendar day (UTC midnight would render a day early west of UTC).
      patch.nextFollowupAt = values.expectedClose
        ? dateOnlyToNoonUtcIso(values.expectedClose)
        : null;
    }
    // Set-once-lock (LS-1): source is only editable while Other/Unknown.
    if (isLeadSourceEditable(deal.leadSource)) {
      if (dirtyFields.leadSource) patch.leadSource = values.leadSource;
      if (dirtyFields.leadSource || dirtyFields.leadSourceNote) {
        patch.leadSourceNote = values.leadSource === "other" ? values.leadSourceNote?.trim() || null : null;
      }
    }
    if (dirtyFields.employeeCountRange) {
      patch.employeeCountRange = values.employeeCountRange;
    }
    if (dirtyFields.lostReasonCategory) {
      patch.lostReasonCategory = values.lostReasonCategory ?? null;
    }
    if (dirtyFields.lostReasonNotes) {
      patch.lostReasonNotes = values.lostReasonNotes ?? null;
    }

    if (Object.keys(patch).length === 0) {
      toast("No changes to save");
      onOpenChange(false);
      return;
    }

    try {
      await update.mutateAsync({ id: deal.id, patch });
      toast.success("Deal updated");
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
      await del.mutateAsync(deal.id);
      toast.success("Deal deleted");
      onOpenChange(false);
      onDeleted?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete deal");
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
              Edit deal
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
            id="edit-deal-form"
            onSubmit={handleSubmit(onSubmit)}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-4"
            noValidate
          >
            <div className="flex flex-col gap-6">
              <section className="flex flex-col gap-3">
                <h3 className="text-body-strong text-text-default">Company</h3>
                <FormField htmlFor="companyName" label="Company name" required error={errors.companyName?.message}>
                  <Input id="companyName" {...register("companyName")} />
                </FormField>
                <FormField htmlFor="address" label="Address" helper="We'll geocode for Path">
                  <Input id="address" placeholder="Street address" {...register("address")} />
                </FormField>
                <Controller
                  control={control}
                  name="employeeCountRange"
                  render={({ field }) => (
                    <FormField htmlFor="employeeCountRange" label="Employee count">
                      <Select
                        id="employeeCountRange"
                        value={field.value ?? ""}
                        onValueChange={field.onChange}
                        options={EMPLOYEE_COUNT_OPTIONS}
                        placeholder="Select range"
                      />
                    </FormField>
                  )}
                />
              </section>

              <div className="h-px w-full bg-border-subtle" aria-hidden />

              <section className="flex flex-col gap-3">
                <h3 className="text-body-strong text-text-default">Primary contact</h3>
                <FormField htmlFor="contactName" label="Contact name" required error={errors.contactName?.message}>
                  <Input id="contactName" {...register("contactName")} />
                </FormField>
                <FormField htmlFor="contactEmail" label="Email" error={errors.contactEmail?.message}>
                  <Input id="contactEmail" type="email" {...register("contactEmail")} />
                </FormField>
                <Controller
                  control={control}
                  name="contactPhone"
                  render={({ field }) => (
                    <FormField htmlFor="contactPhone" label="Phone" required error={errors.contactPhone?.message}>
                      <Input
                        id="contactPhone"
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        value={field.value ?? ""}
                        // Raw value while editing (so backspacing a formatting
                        // char deletes naturally), formatted on blur. Submit
                        // strips to digits regardless (Path QA D).
                        onChange={(e) => field.onChange(e.target.value)}
                        onBlur={(e) => {
                          field.onChange(formatUSPhone(e.target.value));
                          field.onBlur();
                        }}
                      />
                    </FormField>
                  )}
                />
              </section>

              <div className="h-px w-full bg-border-subtle" aria-hidden />

              <section className="flex flex-col gap-3">
                <h3 className="text-body-strong text-text-default">Deal</h3>
                <FormField htmlFor="dealValue" label="Deal value" required error={errors.dealValue?.message}>
                  <Input id="dealValue" type="number" prefix="$" {...register("dealValue")} />
                </FormField>
                <Controller
                  control={control}
                  name="stage"
                  render={({ field }) => (
                    <FormField htmlFor="stage" label="Stage" required error={errors.stage?.message}>
                      <Select
                        id="stage"
                        value={field.value}
                        onValueChange={(v) => field.onChange(v as DealStage)}
                        options={STAGE_OPTIONS}
                      />
                    </FormField>
                  )}
                />
                {showLostReason && (
                  <Controller
                    control={control}
                    name="lostReasonCategory"
                    render={({ field }) => (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-1">
                          <span className="text-body-strong text-text-default">Loss reason</span>
                          <span className="text-body-md text-status-danger">*</span>
                        </div>
                        {errors.lostReasonCategory && (
                          <p className="text-caption text-status-danger" role="alert">
                            {errors.lostReasonCategory.message}
                          </p>
                        )}
                        <RadioGroup.Root
                          value={field.value ?? ""}
                          onValueChange={(v) => field.onChange(v as LostReasonCategory)}
                          aria-label="Loss reason"
                          className="flex flex-col gap-1.5"
                        >
                          {(Object.keys(LOST_REASON_LABEL) as LostReasonCategory[]).map((key) => (
                            <RadioGroup.Item
                              key={key}
                              value={key}
                              id={`edit-lost-reason-${key}`}
                              className={cn(
                                "group flex w-full cursor-pointer items-center gap-3 rounded-radius-md border px-3 py-2.5 text-left transition-colors",
                                "border-border-subtle bg-surface-default",
                                "hover:bg-surface-elevated",
                                "data-[state=checked]:border-brand-primary data-[state=checked]:bg-brand-primary-5",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2",
                              )}
                            >
                              <span
                                className={cn(
                                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-radius-full border-2 transition-colors",
                                  "border-border-default group-data-[state=checked]:border-brand-primary",
                                )}
                                aria-hidden
                              >
                                <span className="hidden h-2 w-2 rounded-radius-full bg-brand-primary group-data-[state=checked]:block" />
                              </span>
                              <label
                                htmlFor={`edit-lost-reason-${key}`}
                                className="cursor-pointer text-body-md text-text-default"
                              >
                                {LOST_REASON_LABEL[key]}
                              </label>
                            </RadioGroup.Item>
                          ))}
                        </RadioGroup.Root>
                        <div className="mt-1 flex flex-col gap-1">
                          <label
                            htmlFor="edit-lost-reason-notes"
                            className="text-body-strong text-text-default"
                          >
                            Notes{" "}
                            <span className="text-body-md font-normal text-text-muted">(optional)</span>
                          </label>
                          <Controller
                            control={control}
                            name="lostReasonNotes"
                            render={({ field: notesField }) => (
                              <NotesFieldWithMic
                                id="edit-lost-reason-notes"
                                value={notesField.value ?? ""}
                                onChange={(v) => notesField.onChange(v || null)}
                                maxLength={500}
                                rows={3}
                                placeholder="Add context for your manager."
                              />
                            )}
                          />
                        </div>
                      </div>
                    )}
                  />
                )}
                <FormField htmlFor="probability" label="Win probability" required error={errors.probability?.message}>
                  <Input id="probability" type="number" suffix="%" {...register("probability")} />
                </FormField>
                <FormField htmlFor="expectedClose" label="Expected close">
                  <Input id="expectedClose" type="date" {...register("expectedClose")} />
                </FormField>
                {isLeadSourceEditable(deal.leadSource) ? (
                  <>
                    <Controller
                      control={control}
                      name="leadSource"
                      render={({ field }) => (
                        <FormField htmlFor="leadSource" label="Lead source" error={errors.leadSource?.message}>
                          <Select
                            id="leadSource"
                            value={field.value ?? ""}
                            onValueChange={field.onChange}
                            options={REP_SOURCE_OPTIONS}
                            placeholder="Select source"
                          />
                        </FormField>
                      )}
                    />
                    {watch("leadSource") === "other" && (
                      <Controller
                        control={control}
                        name="leadSourceNote"
                        render={({ field }) => (
                          <FormField htmlFor="leadSourceNote" label="Source note" error={errors.leadSourceNote?.message}>
                            <Input
                              id="leadSourceNote"
                              value={field.value ?? ""}
                              onChange={field.onChange}
                              placeholder="Where did this lead come from?"
                            />
                          </FormField>
                        )}
                      />
                    )}
                  </>
                ) : (
                  // Set once at creation and locked (LS-1): show it read-only.
                  <FormField htmlFor="leadSource" label="Lead source">
                    <div className="flex items-center gap-2 rounded-radius-md border border-border-subtle bg-surface-sunken px-3 py-2 text-body-md text-text-default">
                      <span>{leadSourceLabel(deal.leadSource)}</span>
                      <span className="rounded-radius-sm bg-surface-default px-1.5 py-0.5 text-caption uppercase tracking-wide text-text-subtle">
                        {leadSourceSetBy(deal.leadSource) === "system" ? "System set" : "Set at creation"}
                      </span>
                    </div>
                  </FormField>
                )}
              </section>
            </div>
          </form>

          {/* Sticky footer — delete (gated) on the left, save/cancel on the right */}
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
                  {confirmDelete ? "Tap again to confirm" : "Delete deal"}
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
                form="edit-deal-form"
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

export default EditDealSheet;
