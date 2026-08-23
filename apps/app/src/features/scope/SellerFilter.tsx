/**
 * SellerFilter — the shared "view a specific seller" control for Pipeline and
 * Partners (PRD 6.12.A Bundle 3, FR-HIER-20). Rendered only for viewers with at
 * least one report. Controlled: the page owns the `owner` URL param and passes
 * value + onChange, so the filter reduces the queried set and the whole screen
 * recomputes from it (FR-HIER-22).
 */

import { Select } from "@/components/navigatr";
import type { Seller } from "./useViewerScope";

/** Sentinel for the "All sellers" option (Radix Select needs a non-empty
 *  string value). */
export const ALL_SELLERS = "__all_sellers__";

export function SellerFilter({
  sellers,
  value,
  onChange,
  ariaLabel = "Filter by seller",
}: {
  sellers: Seller[];
  /** Selected owner id, or null for "All sellers". */
  value: string | null;
  onChange: (ownerId: string | null) => void;
  ariaLabel?: string;
}) {
  const options = [
    { value: ALL_SELLERS, label: "All sellers" },
    ...sellers.map((s) => ({ value: s.id, label: s.name })),
  ];
  return (
    <Select
      value={value ?? ALL_SELLERS}
      onValueChange={(v) => onChange(v === ALL_SELLERS ? null : v)}
      options={options}
      aria-label={ariaLabel}
      fullWidth={false}
      size="sm"
    />
  );
}
