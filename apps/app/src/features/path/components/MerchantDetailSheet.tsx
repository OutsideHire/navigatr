/**
 * MerchantDetailSheet — bottom sheet (mobile) / centered modal (desktop)
 * with merchant details and quick actions.
 *
 * Same Radix Dialog shell pattern as AddDealSheet / LogActivitySheet so
 * the responsive behavior is identical: bottom-up on mobile, centered
 * on desktop, drag handle on mobile.
 *
 * Quick actions are mocked for sprint 1 — Sprint 2 wires real handlers
 * (Add to Path, Log Drop-In, Create Deal).
 */

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Calendar, Check, Mail, MapPin, PhoneIcon, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button, PhoneWithClickToCall } from "@/components/navigatr";
import {
  CATEGORY_LABEL,
  STATUS_LABEL,
  STATUS_PILL_CLASS,
  type Merchant,
} from "../mockData";
import { formatDistance } from "@/lib/distance";
import { usePathQueue } from "../hooks/usePathQueue";

export interface MerchantDetailSheetProps {
  merchant: Merchant | null;
  distanceMeters?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MerchantDetailSheet({
  merchant,
  distanceMeters,
  open,
  onOpenChange,
}: MerchantDetailSheetProps) {
  // Hooks must come before any early return.
  const inQueue = usePathQueue((s) => (merchant ? s.has(merchant.id) : false));
  const addToQueue = usePathQueue((s) => s.add);
  const removeFromQueue = usePathQueue((s) => s.remove);

  const lastActivityLabel = merchant?.lastActivity
    ? new Date(merchant.lastActivity).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "Never contacted";

  // IMPORTANT: render <Dialog.Root> unconditionally so Radix controls its
  // own portal + overlay lifecycle. If we returned null when merchant is
  // missing, the overlay would orphan in the DOM during a mid-transition
  // unmount (e.g. user changes the filter while the sheet is closing).
  // The content inside Portal is the only thing gated on `merchant`.
  return (
    <Dialog.Root open={open && merchant !== null} onOpenChange={onOpenChange}>
      {merchant && (
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
            "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-radius-lg",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-[480px] sm:-translate-x-1/2 sm:-translate-y-1/2",
            "sm:rounded-radius-lg sm:max-h-[80vh]",
            "sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:zoom-out-95",
          )}
        >
          {/* Drag handle — mobile only */}
          <div className="flex shrink-0 justify-center pt-2 sm:hidden" aria-hidden>
            <div className="h-1 w-10 rounded-radius-full bg-border-default" />
          </div>

          {/* Header */}
          <div className="flex shrink-0 items-start justify-between gap-2 px-5 pb-2 pt-3 sm:pt-5">
            <div className="flex min-w-0 flex-col gap-1">
              <Dialog.Title className="text-heading-sm text-text-default">{merchant.name}</Dialog.Title>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("inline-flex items-center rounded-radius-full px-2 py-0.5 text-caption font-medium", STATUS_PILL_CLASS[merchant.status])}>
                  {STATUS_LABEL[merchant.status]}
                </span>
                <span className="text-caption text-text-muted">{CATEGORY_LABEL[merchant.category]}</span>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-radius-sm text-text-muted hover:bg-surface-sunken hover:text-text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
              >
                <X className="h-5 w-5" />
              </button>
            </Dialog.Close>
          </div>

          {/* Body — scrollable */}
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-4">
            {/* Detail rows */}
            <div className="flex flex-col gap-3">
              <DetailRow icon={MapPin} label="Address" value={merchant.address} sub={distanceMeters !== undefined ? formatDistance(distanceMeters) : undefined} />
              <DetailRow icon={PhoneIcon} label="Phone">
                <PhoneWithClickToCall phoneNumber={merchant.phone} size="sm" />
              </DetailRow>
              {merchant.email && <DetailRow icon={Mail} label="Email" value={merchant.email} />}
              <DetailRow icon={Calendar} label="Last activity" value={lastActivityLabel} />
            </div>

            {merchant.note && (
              <div className="rounded-radius-md bg-surface-sunken p-3">
                <p className="text-caption font-medium text-text-default">Notes</p>
                <p className="mt-1 text-body-sm text-text-default">{merchant.note}</p>
              </div>
            )}
          </div>

          {/* Sticky footer — quick actions */}
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border-subtle bg-surface-default px-5 py-3">
            <Button
              variant="tertiary"
              size="md"
              onClick={() => toast("Log drop-in lands in sprint 2")}
            >
              Log drop-in
            </Button>
            {inQueue ? (
              <Button
                variant="secondary"
                size="md"
                leadingIcon={Check}
                onClick={() => {
                  removeFromQueue(merchant.id);
                  toast(`Removed ${merchant.name} from path`);
                }}
              >
                Added to path
              </Button>
            ) : (
              <Button
                variant="primary"
                size="md"
                leadingIcon={Plus}
                onClick={() => {
                  addToQueue(merchant.id);
                  toast.success(`Added ${merchant.name} to today's path`);
                }}
              >
                Add to today's path
              </Button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
      )}
    </Dialog.Root>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
  sub,
  children,
}: {
  icon: typeof MapPin;
  label: string;
  value?: string;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-eyebrow text-text-subtle">{label}</span>
        {children ?? <span className="text-body-md text-text-default">{value}</span>}
        {sub && <span className="text-caption text-text-muted">{sub}</span>}
      </div>
    </div>
  );
}

export default MerchantDetailSheet;
