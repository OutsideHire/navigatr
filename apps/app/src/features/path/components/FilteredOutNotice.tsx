/**
 * FilteredOutNotice: the escape hatch for discovery filtering.
 *
 * Discovery hides two kinds of business by default: national chains, and
 * home-based businesses a rep cannot walk into. Both are inferred, and
 * inference is wrong in both directions. A beta ISO reported ~70% of their
 * discovered businesses were residential, so the filter has to be aggressive,
 * and an aggressive filter with no way back silently deletes a rep's territory.
 *
 * So nothing is ever hidden without saying so. This shows the count and lets
 * the rep pull them back in one tap, with a reason on each so they learn what
 * the filter is doing rather than distrusting the whole list.
 *
 * The taps are also the feedback signal: if reps keep recovering the same kind
 * of business, the rule is wrong and usage tells us before a customer does.
 */
import { EyeOff, Eye } from "lucide-react";
import { Button } from "@/components/navigatr";

export interface FilteredOutNoticeProps {
  /** Home-based businesses hidden by the premises filter. */
  homeBased: number;
  /** National chains hidden by the brand list. */
  chains: number;
  /** True when the rep has already revealed them. */
  showing: boolean;
  onToggle: () => void;
}

/** "3 chains", "12 home-based", or both, so the count is never unexplained. */
function describe(homeBased: number, chains: number): string {
  const parts: string[] = [];
  if (homeBased > 0) parts.push(`${homeBased} home-based`);
  if (chains > 0) parts.push(`${chains} ${chains === 1 ? "chain" : "chains"}`);
  return parts.join(" and ");
}

export function FilteredOutNotice({
  homeBased,
  chains,
  showing,
  onToggle,
}: FilteredOutNoticeProps) {
  const total = homeBased + chains;
  // Nothing was filtered: stay silent rather than reassure about a non-event.
  if (total <= 0) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-radius-md border border-border-subtle bg-surface-sunken px-3 py-2">
      <span className="text-caption text-text-muted">
        {showing ? (
          <>Showing {total} filtered {total === 1 ? "business" : "businesses"} ({describe(homeBased, chains)}).</>
        ) : (
          <>
            {total} {total === 1 ? "business" : "businesses"} filtered out ({describe(homeBased, chains)}).
          </>
        )}
      </span>
      <Button
        type="button"
        variant="tertiary"
        size="sm"
        leadingIcon={showing ? EyeOff : Eye}
        onClick={onToggle}
      >
        {showing ? "Hide them" : "Show them"}
      </Button>
    </div>
  );
}

export default FilteredOutNotice;
