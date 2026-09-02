/**
 * ReferralPreviewSheet — read-only quick look at a referral (deal) opened
 * from the partner detail page, so viewing a shared referral doesn't navigate
 * the rep out of the Partners section. Same responsive Radix shell as the
 * Add/Edit sheets (bottom sheet on mobile, centered modal on desktop).
 *
 * All fields come from the already-loaded Deal — no fetch. An explicit
 * "Open in Pipeline" link is the deliberate escape hatch to the full record.
 */

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useNavigate } from "react-router-dom";
import { X, ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge, Button, PhoneWithClickToCall } from "@/components/navigatr";
import {
  STAGE_BADGE_KIND,
  STAGE_LABEL,
  formatMoney,
  formatShortDate,
  type Deal,
} from "@/features/pipeline/mockData";

/** Prettify the free-text lead source; fall back to the raw value. */
import { leadSourceLabel } from "@/features/pipeline/lib/leadSources";

export interface ReferralPreviewSheetProps {
  deal: Deal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-eyebrow text-text-subtle">{label}</span>
      <span className="text-body-md text-text-default">{children}</span>
    </div>
  );
}

export function ReferralPreviewSheet({ deal, open, onOpenChange }: ReferralPreviewSheetProps) {
  const navigate = useNavigate();

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

          <div className="flex shrink-0 items-start justify-between gap-2 px-5 pb-3 pt-3 sm:pt-5">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Dialog.Title className="truncate text-heading-sm text-text-default">
                {deal?.companyName ?? "Referral"}
              </Dialog.Title>
              {deal && (
                <span>
                  <Badge kind={STAGE_BADGE_KIND[deal.stage]}>{STAGE_LABEL[deal.stage]}</Badge>
                </span>
              )}
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

          {deal && (
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-4">
              <div className="flex flex-col gap-3 rounded-radius-md border border-border-subtle bg-surface-sunken p-3">
                {/* A referred deal may be a bare prospect (no contact/phone/email
                    yet). Render each row only when it has a value so the preview
                    never shows an empty CONTACT line, an "Invalid number" phone
                    stub, or an empty mailto link. */}
                {deal.contactName && <Field label="CONTACT">{deal.contactName}</Field>}
                {deal.phone && <PhoneWithClickToCall phoneNumber={deal.phone} size="sm" />}
                {deal.email && (
                  <a
                    href={`mailto:${deal.email}`}
                    className="truncate text-body-md text-accent-blue hover:underline"
                  >
                    {deal.email}
                  </a>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="VALUE">{formatMoney(deal.valueCents)}</Field>
                <Field label="WIN PROBABILITY">{deal.probability}%</Field>
                <Field label="LEAD SOURCE">
                  {deal.leadSource ? leadSourceLabel(deal.leadSource) : "—"}
                </Field>
                <Field label="NEXT FOLLOW-UP">
                  {deal.nextFollowup ? formatShortDate(deal.nextFollowup) : "—"}
                </Field>
              </div>
            </div>
          )}

          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border-subtle bg-surface-default px-5 py-3">
            <Button
              type="button"
              variant="tertiary"
              size="md"
              trailingIcon={ArrowUpRight}
              onClick={() => {
                if (deal) navigate(`/pipeline/${deal.id}`);
              }}
            >
              Open in Pipeline
            </Button>
            <Dialog.Close asChild>
              <Button type="button" variant="secondary" size="md">Close</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default ReferralPreviewSheet;
