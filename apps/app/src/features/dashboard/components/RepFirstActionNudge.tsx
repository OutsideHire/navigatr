/**
 * RepFirstActionNudge — the field rep's first-run card (onboarding A2 slice 2).
 * Purely presentational: it renders the "make your first move" copy and two
 * CTAs and reports intent via callbacks, so routing + the retire condition
 * (useRepFirstAction) stay in the page and this stays trivial to unit-test.
 * The page only renders it for a Sales Professional who hasn't acted yet.
 */
import { Card, Button } from "@/components/navigatr";
import { MapPin } from "lucide-react";

interface Props {
  /** Primary: go log the first stop (Path). */
  onLogStop: () => void;
  /** Secondary: add a deal (Pipeline). */
  onAddDeal: () => void;
}

export function RepFirstActionNudge({ onLogStop, onAddDeal }: Props) {
  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-radius-md bg-surface-sunken text-brand-primary"
          aria-hidden
        >
          <MapPin className="h-5 w-5" />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="text-body-strong text-text-default">Make your first move</h2>
          <p className="text-body-md text-text-muted">
            Open Path to find businesses near you, drop in, and log the visit. Your pipeline builds from there.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="primary" size="md" onClick={onLogStop}>
          Log your first stop
        </Button>
        <Button type="button" variant="tertiary" size="md" onClick={onAddDeal}>
          Add a deal
        </Button>
      </div>
    </Card>
  );
}
