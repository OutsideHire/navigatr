import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "@/components/navigatr";

interface EndRouteSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Stops still pending on the route. */
  pendingCount: number;
  /** A carry/clear action is in flight — disable the buttons. */
  busy?: boolean;
  /** Carry the pending stops to tomorrow. */
  onCarry: () => void;
  /** Clear today's path and start over. */
  onClear: () => void;
}

/**
 * EndRouteSheet — shown from RunningPath's "End route" when stops remain. Lets the
 * rep carry the remaining stops to tomorrow or clear the path and start over.
 */
export function EndRouteSheet({ open, onOpenChange, pendingCount, busy, onCarry, onClear }: EndRouteSheetProps) {
  const noun = pendingCount === 1 ? "stop" : "stops";
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-lg flex-col gap-4 rounded-t-radius-lg bg-surface-default p-5 shadow-card-hover sm:inset-0 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-radius-lg"
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-heading-sm text-text-default">
              End route · {pendingCount} {noun} left
            </Dialog.Title>
            <Dialog.Close asChild>
              <button aria-label="Close" className="rounded-radius-sm p-1 text-text-muted hover:text-text-default">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>
          <p className="text-body-md text-text-muted">
            Carry the remaining {noun} to tomorrow, or clear this path and start over.
          </p>
          <div className="flex flex-col gap-2">
            <Button variant="primary" disabled={busy} loading={busy} onClick={onCarry}>
              Carry {pendingCount} to tomorrow
            </Button>
            <Button variant="tertiary" disabled={busy} onClick={onClear}>
              Clear &amp; start over
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
