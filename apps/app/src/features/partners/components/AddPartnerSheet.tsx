/**
 * AddPartnerSheet — slim add-partner form. Same Radix Dialog shell
 * as AddDealSheet / LogActivitySheet.
 *
 * Sprint 1: mock submit. Pushes the new partner into MOCK_PARTNERS
 * so it appears in the list immediately. Sprint 2 swaps for
 * PartnersService.create + TanStack Query invalidation.
 */

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
import { type PartnerType } from "../mockData";
import { useCreatePartner } from "../hooks/useCreatePartner";
import {
  partnerFormSchema,
  type PartnerFormValues,
  TYPE_OPTIONS,
  formatUSPhone,
} from "./partnerForm";
import { phoneToE164, normalizeEmail } from "@/lib/contactValidation";

export interface AddPartnerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful add so the parent can refresh its list. */
  onAdded?: () => void;
}

export function AddPartnerSheet({ open, onOpenChange, onAdded }: AddPartnerSheetProps) {
  const createPartner = useCreatePartner();
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<PartnerFormValues>({
    resolver: zodResolver(partnerFormSchema),
    defaultValues: {
      name: "",
      company: "",
      type: "accountant",
      phone: "",
      email: "",
      city: "",
      notes: "",
    },
    mode: "onBlur",
  });

  const onSubmit: SubmitHandler<PartnerFormValues> = async (values) => {
    try {
      // Normalize phone to E.164 + trim email via the shared normalizers —
      // same contract as deals.contact_phone. phoneToE164 drops a habitual
      // leading "1" so we never write a doubled country code
      // (e.g. "+112065550101"). Both are required here, so values are
      // non-empty/valid; coerce the `string | null` return to "" defensively.
      await createPartner.mutateAsync({
        name: values.name,
        company: values.company,
        type: values.type,
        phone: phoneToE164(values.phone) ?? "",
        email: normalizeEmail(values.email) ?? "",
        city: values.city ?? "",
        notes: values.notes ?? "",
      });
      toast.success(`${values.name} added`);
      reset();
      onOpenChange(false);
      onAdded?.();
    } catch (err) {
      // RLS denial / network / unique violation — surface raw message.
      toast.error(err instanceof Error ? err.message : "Could not add partner");
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
            <Dialog.Title className="text-heading-sm text-text-default">Add partner</Dialog.Title>
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
            id="add-partner-form"
            onSubmit={handleSubmit(onSubmit)}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-4"
            noValidate
          >
            <div className="flex flex-col gap-4">
              <FormField htmlFor="name" label="Name" required error={errors.name?.message}>
                <Input id="name" placeholder="Full name" {...register("name")} />
              </FormField>

              <FormField htmlFor="company" label="Company" required error={errors.company?.message}>
                <Input id="company" placeholder="Firm or company name" {...register("company")} />
              </FormField>

              <Controller
                control={control}
                name="type"
                render={({ field }) => (
                  <FormField htmlFor="type" label="Type">
                    <Select
                      id="type"
                      value={field.value}
                      onValueChange={(v) => field.onChange(v as PartnerType)}
                      options={TYPE_OPTIONS}
                    />
                  </FormField>
                )}
              />

              <Controller
                control={control}
                name="phone"
                render={({ field }) => (
                  <FormField htmlFor="phone" label="Phone" required error={errors.phone?.message}>
                    <Input
                      id="phone"
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

              <FormField htmlFor="email" label="Email" required error={errors.email?.message}>
                <Input id="email" type="email" placeholder="name@firm.com" {...register("email")} />
              </FormField>

              <FormField htmlFor="city" label="City">
                <Input id="city" placeholder="Austin, TX" {...register("city")} />
              </FormField>

              <Controller
                control={control}
                name="notes"
                render={({ field }) => (
                  <FormField htmlFor="notes" label="About">
                    <NotesFieldWithMic
                      id="notes"
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
              form="add-partner-form"
              variant="primary"
              size="lg"
              loading={isSubmitting}
            >
              Add partner
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default AddPartnerSheet;
