/**
 * EditPartnerSheet — full edit form for an existing partner. Sibling of
 * AddPartnerSheet; same Radix Dialog shell (bottom sheet on mobile,
 * centered modal on desktop). Covers every editable core field
 * (name, company, type, status, phone, email, city, notes).
 *
 * Mirrors EditDealSheet: seed-on-open, dirty-fields-only patch through
 * useUpdatePartner (so an unchanged column is never written), success /
 * error toasts. No delete affordance — edit only.
 */

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useForm, Controller, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  Button,
  FormField,
  Input,
  NotesFieldWithMic,
  Select,
} from "@/components/navigatr";
import {
  editPartnerSchema,
  type EditPartnerValues,
  TYPE_OPTIONS,
  STATUS_OPTIONS,
  digitsOnly,
  formatUSPhone,
  stripUsCountryCode,
} from "./partnerForm";
import { type Partner, type PartnerStatus, type PartnerType } from "../mockData";
import { useUpdatePartner, type UpdatePartnerInput } from "../hooks/useUpdatePartner";

export interface EditPartnerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partner: Partner;
}

export function EditPartnerSheet({ open, onOpenChange, partner }: EditPartnerSheetProps) {
  const update = useUpdatePartner();

  const defaultValues = React.useMemo<EditPartnerValues>(
    () => ({
      name: partner.name,
      company: partner.company,
      type: partner.type,
      status: partner.status,
      phone: formatUSPhone(stripUsCountryCode(partner.phone)),
      email: partner.email,
      city: partner.city,
      notes: partner.notes,
    }),
    [partner],
  );

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<EditPartnerValues>({
    resolver: zodResolver(editPartnerSchema),
    defaultValues,
    mode: "onBlur",
  });

  // Re-seed when the partner prop changes or the sheet re-opens.
  React.useEffect(() => {
    if (open) reset(defaultValues);
  }, [open, defaultValues, reset]);

  const onSubmit: SubmitHandler<EditPartnerValues> = async (values) => {
    // Patch only dirty fields so an unchanged column is never written.
    const patch: UpdatePartnerInput["patch"] = {};
    if (dirtyFields.name) patch.name = values.name;
    if (dirtyFields.company) patch.company = values.company;
    if (dirtyFields.type) patch.type = values.type;
    if (dirtyFields.status) patch.status = values.status;
    if (dirtyFields.phone) patch.phone = "+1" + digitsOnly(values.phone);
    if (dirtyFields.email) patch.email = values.email;
    if (dirtyFields.city) patch.city = values.city ?? "";
    if (dirtyFields.notes) patch.notes = values.notes ?? "";

    if (Object.keys(patch).length === 0) {
      toast("No changes to save");
      onOpenChange(false);
      return;
    }

    try {
      await update.mutateAsync({ id: partner.id, patch });
      toast.success("Partner updated");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save changes");
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
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-[480px] sm:-translate-x-1/2 sm:-translate-y-1/2",
            "sm:rounded-radius-lg sm:max-h-[80vh]",
            "sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:zoom-out-95",
          )}
        >
          <div className="flex shrink-0 justify-center pt-2 sm:hidden" aria-hidden>
            <div className="h-1 w-10 rounded-radius-full bg-border-default" />
          </div>

          <div className="flex shrink-0 items-center justify-between gap-2 px-5 pb-3 pt-3 sm:pt-5">
            <Dialog.Title className="text-heading-sm text-text-default">Edit partner</Dialog.Title>
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
            id="edit-partner-form"
            onSubmit={handleSubmit(onSubmit)}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-4"
            noValidate
          >
            <div className="flex flex-col gap-4">
              <FormField htmlFor="edit-partner-name" label="Name" required error={errors.name?.message}>
                <Input id="edit-partner-name" placeholder="Full name" {...register("name")} />
              </FormField>

              <FormField htmlFor="edit-partner-company" label="Company" required error={errors.company?.message}>
                <Input id="edit-partner-company" placeholder="Firm or company name" {...register("company")} />
              </FormField>

              <Controller
                control={control}
                name="type"
                render={({ field }) => (
                  <FormField htmlFor="edit-partner-type" label="Type">
                    <Select
                      id="edit-partner-type"
                      value={field.value}
                      onValueChange={(v) => field.onChange(v as PartnerType)}
                      options={TYPE_OPTIONS}
                    />
                  </FormField>
                )}
              />

              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <FormField htmlFor="edit-partner-status" label="Status">
                    <Select
                      id="edit-partner-status"
                      value={field.value}
                      onValueChange={(v) => field.onChange(v as PartnerStatus)}
                      options={STATUS_OPTIONS}
                    />
                  </FormField>
                )}
              />

              <Controller
                control={control}
                name="phone"
                render={({ field }) => (
                  <FormField htmlFor="edit-partner-phone" label="Phone" required error={errors.phone?.message}>
                    <Input
                      id="edit-partner-phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="(555) 123-4567"
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(formatUSPhone(e.target.value))}
                      onBlur={field.onBlur}
                    />
                  </FormField>
                )}
              />

              <FormField htmlFor="edit-partner-email" label="Email" required error={errors.email?.message}>
                <Input id="edit-partner-email" type="email" placeholder="name@firm.com" {...register("email")} />
              </FormField>

              <FormField htmlFor="edit-partner-city" label="City">
                <Input id="edit-partner-city" placeholder="Austin, TX" {...register("city")} />
              </FormField>

              <Controller
                control={control}
                name="notes"
                render={({ field }) => (
                  <FormField htmlFor="edit-partner-notes" label="Notes">
                    <NotesFieldWithMic
                      id="edit-partner-notes"
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      placeholder="How you met, what they specialize in, who else they refer..."
                    />
                  </FormField>
                )}
              />
            </div>
          </form>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border-subtle bg-surface-default px-5 py-3">
            <Dialog.Close asChild>
              <Button type="button" variant="tertiary" size="md">Cancel</Button>
            </Dialog.Close>
            <Button
              type="submit"
              form="edit-partner-form"
              variant="primary"
              size="lg"
              loading={isSubmitting}
            >
              Save changes
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default EditPartnerSheet;
