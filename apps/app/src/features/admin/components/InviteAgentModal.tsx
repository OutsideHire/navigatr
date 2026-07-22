/**
 * InviteAgentModal — single-row invite. Form fields: full_name (optional),
 * email (required), role_level (default sales_professional), reports_to
 * (optional; an existing member). Submits via useAdminBulkInvite; the RPC
 * derives the legacy role from role_level, so we no longer send `role`.
 *
 * Note: Select uses Radix Select (onValueChange, not onChange), so the
 * select fields are wired via react-hook-form Controller instead of register.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button, FormField, Input, Select, type SelectOption } from "@/components/navigatr";
import { ROLE_LEVEL_OPTIONS, type RoleLevel } from "@/features/auth/capabilities";
import { useOrgMemberNames } from "@/features/dashboard/hooks/useOrgMemberNames";
import { useAdminBulkInvite } from "../hooks/useAdminBulkInvite";
import { useSendInviteEmails } from "../hooks/useSendInviteEmails";

// Sentinel for the "No manager" option (Radix Select disallows empty values).
const NO_MANAGER = "__none__";

const ROLE_LEVEL_SELECT_OPTIONS: SelectOption[] = ROLE_LEVEL_OPTIONS.map((o) => ({
  value: o.value,
  label: o.label,
}));

const ROLE_LEVEL_VALUES = ROLE_LEVEL_OPTIONS.map((o) => o.value) as [string, ...string[]];

const schema = z.object({
  fullName: z.string().trim().optional(),
  email: z.string().email("Enter a valid email"),
  role_level: z.enum(ROLE_LEVEL_VALUES).default("sales_professional"),
  reports_to: z.string().default(NO_MANAGER),
});
type Values = z.infer<typeof schema>;

export function InviteAgentModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const invite = useAdminBulkInvite();
  const sendEmails = useSendInviteEmails();
  const memberNames = useOrgMemberNames(true);
  const managerOptions: SelectOption[] = [
    { value: NO_MANAGER, label: "No manager" },
    ...Array.from(memberNames, ([id, name]) => ({ value: id, label: name })),
  ];
  const { register, handleSubmit, control, reset, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: "", email: "", role_level: "sales_professional", reports_to: NO_MANAGER },
  });

  const onSubmit = async (values: Values) => {
    try {
      const results = await invite.mutateAsync([{
        email: values.email,
        full_name: values.fullName || null,
        role_level: values.role_level as RoleLevel,
        ...(values.reports_to !== NO_MANAGER ? { reports_to: values.reports_to } : {}),
      }]);
      const row = results[0];
      if (row.ok && row.id) {
        try { await sendEmails.mutateAsync([row.id]); } catch { /* non-fatal */ }
        toast.success(`Invite sent to ${row.email}`);
        reset();
        onOpenChange(false);
      } else {
        toast.error(`Could not invite: ${row.error}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send invite");
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "fixed z-50 flex flex-col bg-surface-default shadow-card-hover",
            "inset-x-0 bottom-0 max-h-[90dvh] rounded-t-radius-lg",
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-radius-lg",
          )}
        >
          <div className="flex items-center justify-between px-5 py-4">
            <Dialog.Title className="text-heading-sm">Invite agent</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close" className="h-8 w-8 rounded text-text-muted hover:bg-surface-sunken">
                <X className="h-5 w-5 mx-auto" />
              </button>
            </Dialog.Close>
          </div>
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 px-5 pb-5" noValidate>
            <FormField label="Full name" htmlFor="invite-name">
              <Input id="invite-name" placeholder="Jane Doe" {...register("fullName")} />
            </FormField>
            <FormField label="Work email" htmlFor="invite-email" required error={errors.email?.message}>
              <Input id="invite-email" type="email" placeholder="jane@company.com" {...register("email")} />
            </FormField>
            <FormField label="Role level" htmlFor="invite-role-level">
              {/* Controller needed: Radix Select uses onValueChange, not onChange */}
              <Controller
                name="role_level"
                control={control}
                render={({ field }) => (
                  <Select
                    id="invite-role-level"
                    options={ROLE_LEVEL_SELECT_OPTIONS}
                    value={field.value}
                    onValueChange={field.onChange}
                    name={field.name}
                  />
                )}
              />
            </FormField>
            <FormField label="Reports to" htmlFor="invite-reports-to">
              <Controller
                name="reports_to"
                control={control}
                render={({ field }) => (
                  <Select
                    id="invite-reports-to"
                    options={managerOptions}
                    value={field.value}
                    onValueChange={field.onChange}
                    name={field.name}
                  />
                )}
              />
            </FormField>
            <div className="mt-2 flex justify-end gap-2">
              <Dialog.Close asChild><Button type="button" variant="tertiary" size="md">Cancel</Button></Dialog.Close>
              <Button type="submit" variant="primary" size="md" loading={isSubmitting}>Send invite</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
