/**
 * DealContactSheet — add/edit an additional contact on a deal.
 *
 * Same Radix Dialog shell as AddPartnerSheet. Local form state (not
 * react-hook-form) since the field set is small and we seed from a
 * `contact` prop in edit mode. On submit it calls the create or update
 * mutation from useDealContacts, then closes; failures surface via toast.
 */

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
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
import { DEAL_CONTACT_ROLES } from "../lib/dealContactRoles";
import {
  useCreateDealContact,
  useUpdateDealContact,
  type DealContact,
} from "../hooks/useDealContacts";

export interface DealContactSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  /** When provided, the sheet is in edit mode and seeds from this contact. */
  contact?: DealContact;
}

// Radix Select forbids an empty-string item value (reserved for "clear"),
// so we use a sentinel for the unset option and map it to "" on the way out.
const ROLE_NONE = "__none__";
const ROLE_OPTIONS = [{ value: ROLE_NONE, label: "No role" }, ...DEAL_CONTACT_ROLES];

interface FormState {
  name: string;
  title: string;
  email: string;
  phone: string;
  role: string;
  note: string;
}

function seed(contact?: DealContact): FormState {
  return {
    name: contact?.name ?? "",
    title: contact?.title ?? "",
    email: contact?.email ?? "",
    phone: contact?.phone ?? "",
    role: contact?.role ?? "",
    note: contact?.note ?? "",
  };
}

export function DealContactSheet({ open, onOpenChange, dealId, contact }: DealContactSheetProps) {
  const createContact = useCreateDealContact();
  const updateContact = useUpdateDealContact();
  const isEdit = !!contact;
  const isPending = createContact.isPending || updateContact.isPending;

  const [form, setForm] = useState<FormState>(() => seed(contact));

  // Reset form whenever the sheet opens or the target contact changes.
  useEffect(() => {
    if (open) setForm(seed(contact));
  }, [open, contact]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const canSubmit = form.name.trim() !== "" && !isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      const trimmedName = form.name.trim();
      if (isEdit && contact) {
        await updateContact.mutateAsync({
          id: contact.id,
          dealId,
          patch: {
            name: trimmedName,
            title: form.title,
            email: form.email,
            phone: form.phone,
            role: form.role,
            note: form.note,
          },
        });
      } else {
        await createContact.mutateAsync({
          dealId,
          name: trimmedName,
          title: form.title,
          email: form.email,
          phone: form.phone,
          role: form.role,
          note: form.note,
        });
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save contact");
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
            <Dialog.Title className="text-heading-sm text-text-default">
              {isEdit ? "Edit contact" : "Add contact"}
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
            id="deal-contact-form"
            onSubmit={handleSubmit}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-4"
            noValidate
          >
            <div className="flex flex-col gap-4">
              <FormField htmlFor="dc-name" label="Name" required>
                <Input
                  id="dc-name"
                  placeholder="Full name"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                />
              </FormField>

              <FormField htmlFor="dc-title" label="Title">
                <Input
                  id="dc-title"
                  placeholder="e.g. Office Manager"
                  value={form.title}
                  onChange={(e) => set("title", e.target.value)}
                />
              </FormField>

              <FormField htmlFor="dc-email" label="Email">
                <Input
                  id="dc-email"
                  type="email"
                  placeholder="name@company.com"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                />
              </FormField>

              <FormField htmlFor="dc-phone" label="Phone">
                <Input
                  id="dc-phone"
                  type="tel"
                  inputMode="tel"
                  placeholder="(555) 123-4567"
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                />
              </FormField>

              <FormField htmlFor="dc-role" label="Role">
                <Select
                  id="dc-role"
                  value={form.role === "" ? ROLE_NONE : form.role}
                  onValueChange={(v) => set("role", v === ROLE_NONE ? "" : v)}
                  options={ROLE_OPTIONS}
                  placeholder="No role"
                />
              </FormField>

              <FormField htmlFor="dc-note" label="Note">
                <NotesFieldWithMic
                  id="dc-note"
                  value={form.note}
                  onChange={(v) => set("note", v)}
                  placeholder="Context about this contact…"
                />
              </FormField>
            </div>
          </form>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border-subtle bg-surface-default px-5 py-3">
            <Dialog.Close asChild>
              <Button type="button" variant="tertiary" size="md">
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              type="submit"
              form="deal-contact-form"
              variant="primary"
              size="lg"
              disabled={!canSubmit}
              loading={isPending}
            >
              {isEdit ? "Save" : "Add contact"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default DealContactSheet;
