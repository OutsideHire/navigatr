import { Sparkles, MapPinned } from "lucide-react";
import { Card } from "@/components/navigatr";

interface PathEntryProps {
  onCreate: () => void;
  onPlan: () => void;
}

/**
 * PathEntry — first thing a rep sees with no active path: pick how to build one.
 * Create = auto-discover from GPS, prospect now. Plan = search a city/ZIP and
 * hand-pick for a day. Two large, obviously-tappable cards (each a button).
 */
export function PathEntry({ onCreate, onPlan }: PathEntryProps) {
  return (
    <div className="mt-6 flex flex-col gap-3 self-stretch md:mx-auto md:w-full md:max-w-2xl">
      <button type="button" onClick={onCreate} className="text-left">
        <Card padding="lg" className="flex items-start gap-4 transition-colors hover:border-border-strong">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-radius-md bg-surface-sunken text-text-default">
            <Sparkles className="h-5 w-5" aria-hidden />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-heading-sm text-text-default">Create a Path</p>
            <p className="text-body-md text-text-muted">
              Auto-discover nearby businesses from your current location and start prospecting right now. Best when you&apos;re already in the field.
            </p>
          </div>
        </Card>
      </button>
      <button type="button" onClick={onPlan} className="text-left">
        <Card padding="lg" className="flex items-start gap-4 transition-colors hover:border-border-strong">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-radius-md bg-surface-sunken text-text-default">
            <MapPinned className="h-5 w-5" aria-hidden />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-heading-sm text-text-default">Plan a Path</p>
            <p className="text-body-md text-text-muted">
              Search by city or ZIP, filter by business type, and hand-pick the stops you want to visit later. Best for prepping an upcoming day.
            </p>
          </div>
        </Card>
      </button>
    </div>
  );
}
