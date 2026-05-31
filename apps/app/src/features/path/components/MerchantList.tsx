/**
 * MerchantList — sorted list of nearby merchants, mobile-bottom-sheet
 * and desktop-sidebar friendly.
 *
 * Each row: status pill + name + category, with distance and last-
 * activity badges trailing. Tap a row → onSelect fires; parent decides
 * whether that opens a detail sheet, flies the map to the pin, etc.
 *
 * Empty state shows when filters/search produce no matches.
 */

import { ChevronRight, MapPin, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, Card, ListRow } from "@/components/navigatr";
import {
  CATEGORY_LABEL,
  STATUS_LABEL,
  STATUS_PILL_CLASS,
  type Merchant,
} from "../mockData";
import { formatDistance } from "@/lib/distance";

export interface MerchantWithDistance extends Merchant {
  distanceMeters: number;
}

export interface MerchantListProps {
  /** Items already sorted (caller usually sorts by distance). */
  merchants: MerchantWithDistance[];
  /** Highlights the selected row visually so it pairs with the map's focused pin. */
  selectedId?: string | null;
  onSelect?: (m: Merchant) => void;
  /** When provided, the empty state surfaces a "Reset filters" CTA. The page
   *  passes this in when a stage filter is active so reps aren't stranded. */
  onResetFilters?: () => void;
}

function StatusPill({ status }: { status: Merchant["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-radius-full px-2 py-0.5 text-caption font-medium",
        STATUS_PILL_CLASS[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function relativeLastActivity(iso: string | null): string {
  if (!iso) return "Never contacted";
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.round(diff / (1000 * 60 * 60 * 24));
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return "Over a year";
}

export function MerchantList({ merchants, selectedId, onSelect, onResetFilters }: MerchantListProps) {
  if (merchants.length === 0) {
    return (
      <Card padding="lg" className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
          <MapPin className="h-6 w-6" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-body-strong text-text-default">Nothing matches right now</p>
          <p className="text-caption text-text-muted">Try a wider radius or a different category.</p>
        </div>
        {onResetFilters && (
          <Button variant="secondary" size="sm" leadingIcon={RotateCcw} onClick={onResetFilters}>
            Reset filters
          </Button>
        )}
      </Card>
    );
  }

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex flex-col">
        {merchants.map((m, i) => {
          const isSelected = selectedId === m.id;
          return (
            <div
              key={m.id}
              className={cn(
                "transition-colors",
                i > 0 && "border-t border-border-subtle",
                isSelected && "bg-brand-primary-10",
              )}
            >
              <ListRow
                onClick={() => onSelect?.(m)}
                title={
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-body-strong text-text-default">{m.name}</span>
                    <StatusPill status={m.status} />
                  </span>
                }
                subtitle={
                  <span className="text-caption text-text-muted">
                    {CATEGORY_LABEL[m.category]} · {m.employeeCountRange} · {relativeLastActivity(m.lastActivity)}
                  </span>
                }
                trailing={
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-caption tabular-nums text-text-muted">{formatDistance(m.distanceMeters)}</span>
                    <ChevronRight className="h-4 w-4 text-text-subtle" aria-hidden />
                  </div>
                }
              />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export default MerchantList;
