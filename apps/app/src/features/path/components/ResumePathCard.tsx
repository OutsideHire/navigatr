import { RotateCcw } from "lucide-react";
import { Button, Card } from "@/components/navigatr";
import { formatPathDate } from "../lib/today";

interface ResumePathCardProps {
  /** path_date (yyyy-mm-dd) of the unfinished path. */
  pathDate: string;
  /** Number of still-pending stops on it. */
  pendingCount: number;
  /** Continue the path into today. */
  onContinue: () => void;
  /** Close it out (finalize, don't carry). */
  onClose: () => void;
  /** Disable the actions while a carryover mutation is in flight. */
  disabled?: boolean;
  /** Override "today" for deterministic tests. */
  todayIso?: string;
}

/**
 * ResumePathCard — leads the Path entry screen when the rep has an unfinished
 * path from a previous day. Brand-coded so it reads as the primary action (the
 * usual reason a rep opens the page in the morning is to keep going). Two explicit
 * choices, no ambiguous "dismiss".
 */
export function ResumePathCard({ pathDate, pendingCount, onContinue, onClose, disabled, todayIso }: ResumePathCardProps) {
  const when = formatPathDate(pathDate, todayIso);
  const stops = `${pendingCount} stop${pendingCount === 1 ? "" : "s"} left`;
  return (
    <Card
      padding="lg"
      className="mt-6 flex flex-col gap-3 self-stretch border-brand-primary md:mx-auto md:w-full md:max-w-2xl"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-radius-md bg-brand-primary-10 text-brand-primary">
          <RotateCcw className="h-5 w-5" aria-hidden />
        </span>
        <div className="flex flex-col">
          <p className="text-heading-sm text-text-default">Pick up your last path</p>
          <p className="text-body-md text-text-muted">
            {stops} &middot; {when}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={onContinue} disabled={disabled}>Continue today</Button>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={disabled}>Close it out</Button>
      </div>
    </Card>
  );
}
