import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { toast } from "sonner";
import { IndustryEditor } from "./IndustryEditor";
import { usePathPreferences, useUpdateDefaultIndustries } from "../hooks/usePathPreferences";
import type { IndustrySelection } from "../lib/industrySelection";

interface PathSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * PathSettings — a sheet to manage Path preferences. v1 section: Default
 * industries (edited via IndustryEditor in "default" scope; Save upserts the
 * per-rep preference). Mirrors the CreatePathWizard/PathPlanSheet dialog shell.
 */
export function PathSettings({ open, onOpenChange }: PathSettingsProps) {
  const { data: defaults, isLoading } = usePathPreferences();
  const update = useUpdateDefaultIndustries();

  const handleSave = async (sel: IndustrySelection) => {
    try {
      await update.mutateAsync(sel);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save. Check your connection and try again.");
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[88dvh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-t-radius-lg bg-surface-default p-5 shadow-lg md:inset-0 md:bottom-auto md:top-1/2 md:max-h-[80dvh] md:-translate-y-1/2 md:rounded-radius-lg"
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-heading-sm text-text-default">Path settings</Dialog.Title>
            <Dialog.Close asChild>
              <button aria-label="Close" className="rounded-radius-sm p-1 text-text-muted hover:text-text-default">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-0.5">
              <h3 className="text-body-strong text-text-default">Default industries</h3>
              <p className="text-caption text-text-muted">Auto-applied to every new path. Edit any path without changing this.</p>
            </div>
            {isLoading || defaults === undefined ? (
              <p className="text-body-md text-text-muted">Loading…</p>
            ) : (
              <IndustryEditor
                value={defaults}
                scope="default"
                onUseForPath={() => {}}
                onSaveDefault={handleSave}
              />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
