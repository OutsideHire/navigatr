/**
 * PlanSavedStep — final step of the Plan-a-Path wizard.
 *
 * Confirmation summary after the path is saved (createPath + addStops ran in the
 * parent's review Continue). Shows a checklist and the exit actions:
 *   - "View upcoming" → /path
 *   - "Build another" → reset the wizard to `mode`
 *   - "Done"          → /path
 */
import { CheckCircle2, Route as RouteIcon } from "lucide-react";
import { Button, Card } from "@/components/navigatr";

export interface PlanSavedStepProps {
  /** Human name for the saved path (e.g. the origin label). */
  pathName: string;
  stopCount: number;
  onViewUpcoming: () => void;
  onBuildAnother: () => void;
  onDone: () => void;
}

export function PlanSavedStep({
  pathName,
  stopCount,
  onViewUpcoming,
  onBuildAnother,
  onDone,
}: PlanSavedStepProps) {
  const checklist = [
    `${stopCount} ${stopCount === 1 ? "stop" : "stops"} added`,
    "Route optimized for the shortest drive",
    "Visible on mobile and web",
  ];

  return (
    <div className="flex flex-col gap-5 md:mx-auto md:w-full md:max-w-2xl">
      <Card padding="lg" className="flex flex-col items-center gap-4 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-radius-full bg-status-success-bg text-status-success">
          <CheckCircle2 className="h-7 w-7" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="text-heading-md text-text-default">{pathName} is ready</h2>
          <p className="text-body-md text-text-muted">Your planned path is saved and ready to run.</p>
        </div>
        <ul className="flex w-full max-w-sm flex-col gap-2 text-left">
          {checklist.map((item) => (
            <li key={item} className="flex items-center gap-2 text-body-md text-text-default">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-status-success" aria-hidden />
              {item}
            </li>
          ))}
        </ul>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="primary" leadingIcon={RouteIcon} className="flex-1" onClick={onViewUpcoming}>
          View upcoming
        </Button>
        <Button variant="secondary" className="flex-1" onClick={onBuildAnother}>
          Build another
        </Button>
        <Button variant="tertiary" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

export default PlanSavedStep;
