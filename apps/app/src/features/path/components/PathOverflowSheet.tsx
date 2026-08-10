/**
 * PathOverflowSheet: the header "+" overflow on the Path landing (FR-PATH-UX-12).
 *
 * The daily action ("Start driving" / "Build my day") stays primary on the "Your
 * day" landing. The rarely-used actions ("Add more stops today", "Plan a new area",
 * "Who's near me right now") live here so they stop competing with the daily action
 * every morning. Each action runs its handler, then closes the sheet.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { MapPinned, Navigation, Plus, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/navigatr";

export interface PathOverflowSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Add more nearby stops to today's day (opens discovery). */
  onAddMoreStops: () => void;
  /** Plan a new area for a later day (the plan-a-path wizard). */
  onPlanNewArea: () => void;
  /** Show who's near me right now (opens discovery). */
  onFindNearby: () => void;
}

export function PathOverflowSheet({
  open,
  onOpenChange,
  onAddMoreStops,
  onPlanNewArea,
  onFindNearby,
}: PathOverflowSheetProps) {
  // Each row runs its handler and then closes the sheet.
  const run = (fn: () => void) => () => {
    fn();
    onOpenChange(false);
  };

  const actions: Array<{ label: string; icon: LucideIcon; onClick: () => void }> = [
    { label: "Add more stops today", icon: Plus, onClick: run(onAddMoreStops) },
    { label: "Plan a new area", icon: MapPinned, onClick: run(onPlanNewArea) },
    { label: "Who's near me right now", icon: Navigation, onClick: run(onFindNearby) },
  ];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-lg flex-col gap-4 rounded-t-radius-lg bg-surface-default p-5 shadow-card-hover sm:inset-0 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-radius-lg"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <Dialog.Title className="text-heading-sm text-text-default">
                Something else?
              </Dialog.Title>
              <p className="text-body-md text-text-muted">
                These are here when you need them. Most days you will not.
              </p>
            </div>
            <Dialog.Close asChild>
              <button aria-label="Close" className="rounded-radius-sm p-1 text-text-muted hover:text-text-default">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>
          <div className="flex flex-col gap-2">
            {actions.map(({ label, icon: Icon, onClick }) => (
              <Button key={label} variant="secondary" leadingIcon={Icon} onClick={onClick}>
                {label}
              </Button>
            ))}
            <Button variant="tertiary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default PathOverflowSheet;
