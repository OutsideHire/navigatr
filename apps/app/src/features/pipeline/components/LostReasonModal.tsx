/**
 * LostReasonModal — Radix Dialog prompting the rep for a structured
 * reason when moving a deal to 'lost'.
 *
 * The category is required before Save is enabled; free-text notes are
 * optional. The parent is responsible for persisting the result via
 * useUpdateDeal — this component only captures and surfaces the values.
 */

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as RadioGroup from "@radix-ui/react-radio-group";
import { X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/navigatr";
import { type LostReasonCategory, LOST_REASON_LABEL } from "../mockData";

export interface LostReasonModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called on Save with the chosen category + notes. Parent handles persistence. */
  onSubmit: (category: LostReasonCategory, notes: string | null) => Promise<void> | void;
  /** Defaults from an existing deal (for editing). null when creating. */
  initialCategory?: LostReasonCategory | null;
  initialNotes?: string | null;
}

const CATEGORY_KEYS = Object.keys(LOST_REASON_LABEL) as LostReasonCategory[];

export function LostReasonModal({
  open,
  onOpenChange,
  onSubmit,
  initialCategory,
  initialNotes,
}: LostReasonModalProps) {
  const [selected, setSelected] = React.useState<LostReasonCategory | "">("");
  const [notes, setNotes] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  // Re-seed when the modal opens with initial values.
  React.useEffect(() => {
    if (open) {
      setSelected(initialCategory ?? "");
      setNotes(initialNotes ?? "");
    }
  }, [open, initialCategory, initialNotes]);

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await onSubmit(selected, notes.trim() || null);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save loss reason");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            "fixed inset-0 z-40 bg-black/40",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          )}
        />
        <Dialog.Content
          aria-describedby="lost-reason-desc"
          className={cn(
            "fixed z-50 flex flex-col bg-surface-default text-text-default shadow-card-hover",
            "inset-x-0 bottom-0 max-h-[90dvh] rounded-t-radius-lg",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-[480px] sm:-translate-x-1/2 sm:-translate-y-1/2",
            "sm:rounded-radius-lg sm:max-h-[80vh]",
            "sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:zoom-out-95",
            "sm:data-[state=open]:fade-in-0 sm:data-[state=closed]:fade-out-0",
            "sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=closed]:slide-out-to-bottom-0",
          )}
        >
          {/* Drag handle — mobile only */}
          <div className="flex shrink-0 justify-center pt-2 sm:hidden" aria-hidden>
            <div className="h-1 w-10 rounded-radius-full bg-border-default" />
          </div>

          {/* Header */}
          <div className="flex shrink-0 items-center justify-between gap-2 px-5 pb-3 pt-3 sm:pt-5">
            <Dialog.Title className="text-heading-sm text-text-default">
              Why was this lost?
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="inline-flex h-8 w-8 items-center justify-center rounded-radius-sm text-text-muted hover:bg-surface-sunken hover:text-text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
              >
                <X className="h-5 w-5" />
              </button>
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-4">
            <p id="lost-reason-desc" className="text-body-md text-text-muted">
              Select the primary reason this deal didn&apos;t close. This helps track where deals are lost.
            </p>

            {/* Category radio group */}
            <RadioGroup.Root
              value={selected}
              onValueChange={(v) => setSelected(v as LostReasonCategory)}
              aria-label="Loss reason"
              className="flex flex-col gap-2"
            >
              {CATEGORY_KEYS.map((key) => (
                <RadioGroup.Item
                  key={key}
                  value={key}
                  id={`lost-reason-${key}`}
                  className={cn(
                    "group flex w-full cursor-pointer items-center gap-3 rounded-radius-md border px-4 py-3 text-left transition-colors",
                    "border-border-subtle bg-surface-default",
                    "hover:bg-surface-elevated",
                    "data-[state=checked]:border-brand-primary data-[state=checked]:bg-brand-primary-5",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2",
                  )}
                >
                  {/* Custom radio indicator */}
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-radius-full border-2 transition-colors",
                      "border-border-default group-data-[state=checked]:border-brand-primary",
                    )}
                    aria-hidden
                  >
                    <span className="hidden h-2 w-2 rounded-radius-full bg-brand-primary group-data-[state=checked]:block" />
                  </span>
                  <label
                    htmlFor={`lost-reason-${key}`}
                    className="cursor-pointer text-body-md text-text-default"
                  >
                    {LOST_REASON_LABEL[key]}
                  </label>
                </RadioGroup.Item>
              ))}
            </RadioGroup.Root>

            {/* Notes textarea */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="lost-reason-notes"
                className="text-body-strong text-text-default"
              >
                Notes{" "}
                <span className="text-body-md font-normal text-text-muted">(optional)</span>
              </label>
              <textarea
                id="lost-reason-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="Add context for your manager…"
                className={cn(
                  "w-full resize-none rounded-radius-md border border-border-default bg-surface-default px-3 py-2",
                  "text-body-md text-text-default placeholder:text-text-subtle",
                  "focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-offset-0",
                )}
              />
              <span className="text-right text-caption text-text-subtle">
                {notes.length}/500
              </span>
            </div>
          </div>

          {/* Footer */}
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border-subtle bg-surface-default px-5 py-3">
            <Dialog.Close asChild>
              <Button type="button" variant="tertiary" size="md">
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              type="button"
              variant="primary"
              size="lg"
              disabled={!selected}
              loading={saving}
              onClick={handleSave}
            >
              Save
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default LostReasonModal;
