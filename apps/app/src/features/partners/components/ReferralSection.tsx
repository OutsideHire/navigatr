/**
 * ReferralSection — a reusable, data-agnostic card that lists a set of
 * deals (with company/contact/value/stage + a /pipeline/:id link) and
 * lets the user attach a new one from a passed list of eligible options
 * or remove an existing one.
 *
 * Extracted from PartnerDetailPage's inline ReferralsCard so it can back
 * both inbound (attributed) and outbound referrals. It owns no data
 * mutations or toasts — the parent supplies `onAdd`/`onRemove`, which are
 * expected to perform the mutation, surface their own toasts, and rethrow
 * on failure so this component can keep the picker open.
 */

import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Plus, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge, Button, Card, Select } from "@/components/navigatr";
import {
  STAGE_BADGE_KIND,
  STAGE_LABEL,
  formatMoney,
  type Deal,
} from "@/features/pipeline/mockData";

interface ReferralSectionProps {
  title: string;
  deals: Deal[];
  eligibleOptions: Array<{ value: string; label: string }>;
  addLabel: string;
  onAdd: (dealId: string) => Promise<void>;
  onRemove: (dealId: string) => Promise<void>;
  emptyText?: string;
}

export function ReferralSection({
  title,
  deals,
  eligibleOptions,
  addLabel,
  onAdd,
  onRemove,
  emptyText,
}: ReferralSectionProps) {
  const navigate = useNavigate();
  const [picking, setPicking] = React.useState(false);
  const [pickedDealId, setPickedDealId] = React.useState<string>("");
  const [busy, setBusy] = React.useState(false);
  const [removingId, setRemovingId] = React.useState<string | null>(null);

  const fieldId = React.useId();

  const handleAdd = async () => {
    if (!pickedDealId) return;
    setBusy(true);
    try {
      await onAdd(pickedDealId);
      setPicking(false);
      setPickedDealId("");
    } catch {
      /* onAdd toasts + rethrows; keep picker open */
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (id: string) => {
    setRemovingId(id);
    try {
      await onRemove(id);
    } catch {
      /* onRemove toasts */
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <Card padding="md">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-body-strong text-text-default">
          {title} · {deals.length}
        </h2>
        {!picking && eligibleOptions.length > 0 && (
          <Button variant="tertiary" size="sm" leadingIcon={Plus} onClick={() => setPicking(true)}>
            {addLabel}
          </Button>
        )}
      </div>

      {picking && (
        <div className="mb-3 flex items-end gap-2 rounded-radius-md border border-border-subtle bg-surface-sunken p-3">
          <div className="min-w-0 flex-1">
            <label className="mb-1 block text-caption text-text-muted" htmlFor={fieldId}>
              {addLabel}
            </label>
            <Select
              id={fieldId}
              value={pickedDealId}
              onValueChange={setPickedDealId}
              options={eligibleOptions}
              placeholder="Pick a deal…"
            />
          </div>
          <Button
            variant="primary"
            size="md"
            onClick={handleAdd}
            disabled={!pickedDealId || busy}
          >
            {busy ? "Attaching…" : "Attach"}
          </Button>
          <Button
            variant="tertiary"
            size="md"
            onClick={() => {
              setPicking(false);
              setPickedDealId("");
            }}
          >
            Cancel
          </Button>
        </div>
      )}

      {deals.length === 0 ? (
        <p className="text-body-md text-text-muted">{emptyText ?? "No deals yet."}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {deals.map((d) => (
            <div
              key={d.id}
              className={cn(
                "flex items-center justify-between gap-3 rounded-radius-md border border-border-subtle bg-surface-default p-3",
                "focus-within:ring-2 focus-within:ring-brand-primary focus-within:ring-offset-2 focus-within:ring-offset-surface-canvas",
              )}
            >
              <button
                type="button"
                onClick={() => navigate(`/pipeline/${d.id}`)}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left transition-colors hover:opacity-80 focus-visible:outline-none"
              >
                <div className="flex min-w-0 flex-col">
                  <p className="truncate text-body-strong text-text-default">{d.companyName}</p>
                  <p className="truncate text-caption text-text-muted">{d.contactName}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-body-strong tabular-nums text-text-default">{formatMoney(d.valueCents)}</span>
                  <Badge kind={STAGE_BADGE_KIND[d.stage]}>{STAGE_LABEL[d.stage]}</Badge>
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleRemove(d.id)}
                disabled={removingId === d.id}
                aria-label={`Remove ${d.companyName}`}
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-radius-md text-text-subtle",
                  "transition-colors hover:bg-status-danger-bg hover:text-status-danger",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default ReferralSection;
