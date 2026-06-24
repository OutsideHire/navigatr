/**
 * ContactsTab — the Contacts tab body on the Deal detail page.
 *
 * Shows the deal's primary contact (read-only, sourced from the Deal row)
 * plus a list of additional contacts backed by useDealContacts. Additional
 * contacts can be added, edited (via DealContactSheet) and deleted.
 */

import { useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button, Card } from "@/components/navigatr";
import { DealCallButton } from "@/features/activities/components/DealCallButton";
import type { Deal } from "../mockData";
import { roleLabel } from "../lib/dealContactRoles";
import {
  useDealContacts,
  useDeleteDealContact,
  type DealContact,
} from "../hooks/useDealContacts";
import { DealContactSheet } from "./DealContactSheet";

export interface ContactsTabProps {
  deal: Deal;
  /** When provided, renders an Edit affordance on the primary contact card. */
  onEditPrimary?: () => void;
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-caption font-medium uppercase tracking-wide text-text-muted">
      {children}
    </span>
  );
}

function RolePill({ role }: { role: string | null }) {
  const label = roleLabel(role);
  if (!label) return null;
  return (
    <span className="inline-flex items-center rounded-radius-full bg-surface-sunken px-2 py-0.5 text-caption text-text-muted">
      {label}
    </span>
  );
}

export function ContactsTab({ deal, onEditPrimary }: ContactsTabProps) {
  const { data, isLoading } = useDealContacts(deal.id);
  const deleteContact = useDeleteDealContact();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<DealContact | undefined>(undefined);

  const openAdd = () => {
    setEditing(undefined);
    setSheetOpen(true);
  };
  const openEdit = (contact: DealContact) => {
    setEditing(contact);
    setSheetOpen(true);
  };

  const handleDelete = async (contact: DealContact) => {
    if (!window.confirm(`Delete ${contact.name}?`)) return;
    try {
      await deleteContact.mutateAsync({ id: contact.id, dealId: deal.id });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't delete contact — please try again.",
      );
    }
  };

  const contacts = data ?? [];

  return (
    <div className="flex flex-col gap-6">
      {/* Primary contact */}
      <section className="flex flex-col gap-2">
        <Card padding="md" className="flex flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            <Eyebrow>Primary</Eyebrow>
            {onEditPrimary && (
              <Button
                type="button"
                variant="tertiary"
                size="sm"
                leadingIcon={Pencil}
                onClick={onEditPrimary}
              >
                Edit
              </Button>
            )}
          </div>
          <p className="text-body-md font-medium text-text-default">{deal.contactName}</p>
          {deal.phone && (
            <DealCallButton dealId={deal.id} phoneNumber={deal.phone} size="sm" />
          )}
          {deal.email && (
            <a
              href={`mailto:${deal.email}`}
              className="text-body-sm text-brand-primary hover:underline"
            >
              {deal.email}
            </a>
          )}
        </Card>
      </section>

      {/* Additional contacts */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col">
            <Eyebrow>Contacts</Eyebrow>
            <span className="text-body-md font-medium text-text-default">Additional</span>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            leadingIcon={Plus}
            onClick={openAdd}
          >
            Add contact
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-text-muted">
            <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading contacts" />
          </div>
        ) : contacts.length === 0 ? (
          <p className="py-6 text-center text-body-sm text-text-muted">
            No additional contacts yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {contacts.map((contact) => (
              <li key={contact.id}>
                <Card padding="md" className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-body-md font-medium text-text-default">
                          {contact.name}
                        </span>
                        <RolePill role={contact.role} />
                      </div>
                      {contact.title && (
                        <span className="text-body-sm text-text-muted">{contact.title}</span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="tertiary"
                        size="sm"
                        iconOnly
                        leadingIcon={Pencil}
                        aria-label={`Edit ${contact.name}`}
                        onClick={() => openEdit(contact)}
                      />
                      <Button
                        type="button"
                        variant="tertiary"
                        size="sm"
                        iconOnly
                        leadingIcon={Trash2}
                        aria-label={`Delete ${contact.name}`}
                        onClick={() => handleDelete(contact)}
                      />
                    </div>
                  </div>
                  {contact.phone && (
                    <DealCallButton dealId={deal.id} phoneNumber={contact.phone} size="sm" />
                  )}
                  {contact.email && (
                    <a
                      href={`mailto:${contact.email}`}
                      className={cn("text-body-sm text-brand-primary hover:underline")}
                    >
                      {contact.email}
                    </a>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DealContactSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        dealId={deal.id}
        contact={editing}
      />
    </div>
  );
}

export default ContactsTab;
