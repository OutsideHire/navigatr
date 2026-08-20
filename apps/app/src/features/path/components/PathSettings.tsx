import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { toast } from "sonner";
import { IndustryEditor } from "./IndustryEditor";
import {
  usePathPreferences,
  usePathStartOfDayMinutes,
  usePathEndOfDayMinutes,
  usePathTimezone,
  useUpdateDefaultIndustries,
  useUpdateStartOfDayMinutes,
  useUpdateEndOfDayMinutes,
  useUpdateTimezone,
} from "../hooks/usePathPreferences";
import type { IndustrySelection } from "../lib/industrySelection";
import { DEFAULT_START_OF_DAY_MINUTES, DEFAULT_END_OF_DAY_MINUTES } from "../lib/pathCapacityDefaults";
import { minutesToTimeValue, timeValueToMinutes, endOfDayLabel, workdayWindowError } from "../lib/endOfDayControl";
import { US_TIMEZONES, timezoneLabel, isKnownTimezone } from "../lib/timezones";

interface PathSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * PathSettings — a sheet to manage Path preferences. v1 section: Default
 * industries (edited via IndustryEditor in "default" scope; Save upserts the
 * per-rep preference). Mirrors the CreatePathWizard dialog shell.
 */
export function PathSettings({ open, onOpenChange }: PathSettingsProps) {
  const { data: defaults, isLoading } = usePathPreferences();
  const update = useUpdateDefaultIndustries();
  const { data: startOfDayMinutes } = usePathStartOfDayMinutes();
  const updateStartOfDay = useUpdateStartOfDayMinutes();
  const { data: endOfDayMinutes } = usePathEndOfDayMinutes();
  const updateEndOfDay = useUpdateEndOfDayMinutes();
  const { data: timezone } = usePathTimezone();
  const updateTimezone = useUpdateTimezone();

  // Effective start-of-day: the rep's override, or the 8:00 AM default when unset.
  const effectiveStartOfDay = startOfDayMinutes ?? DEFAULT_START_OF_DAY_MINUTES;
  // Effective end-of-day: the rep's override, or the 6:00 PM default when unset.
  const effectiveEndOfDay = endOfDayMinutes ?? DEFAULT_END_OF_DAY_MINUTES;
  // Effective zone: the rep's stored zone, or the device zone until captured.
  const effectiveTz = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const handleSave = async (sel: IndustrySelection) => {
    try {
      await update.mutateAsync(sel);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save. Check your connection and try again.");
    }
  };

  // Save on change: a single control, so persist immediately rather than adding a
  // second Save button beside the industries one. A partial/garbage time value
  // (timeValueToMinutes null) is ignored, never persisted (a field cannot be
  // cleared into an empty value). A proposed pair shorter than an hour, with the
  // end at or before the start, or crossing midnight is rejected with a toast and
  // not saved (v1.4 Section 7). Keeps the sheet open.
  const handleStartOfDayChange = async (value: string) => {
    const minutes = timeValueToMinutes(value);
    if (minutes === null) return;
    const invalid = workdayWindowError(minutes, effectiveEndOfDay);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    try {
      await updateStartOfDay.mutateAsync(minutes);
      toast.success(`Day starts at ${endOfDayLabel(minutes)}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save. Check your connection and try again.");
    }
  };

  const handleEndOfDayChange = async (value: string) => {
    const minutes = timeValueToMinutes(value);
    if (minutes === null) return;
    const invalid = workdayWindowError(effectiveStartOfDay, minutes);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    try {
      await updateEndOfDay.mutateAsync(minutes);
      toast.success(`Day ends at ${endOfDayLabel(minutes)}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save. Check your connection and try again.");
    }
  };

  // Persist the rep's zone on change. An unresolvable value is ignored.
  const handleTimezoneChange = async (value: string) => {
    if (!isKnownTimezone(value)) return;
    try {
      await updateTimezone.mutateAsync(value);
      toast.success(`Time zone set to ${timezoneLabel(value)}.`);
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
          <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
            <div className="flex flex-col gap-0.5">
              <h3 className="text-body-strong text-text-default">Your workday</h3>
              <p className="text-caption text-text-muted">
                New stops are suggested between these times. Currently {endOfDayLabel(effectiveStartOfDay)} to {endOfDayLabel(effectiveEndOfDay)}.
              </p>
            </div>
            <label className="flex items-center justify-between gap-3">
              <span className="text-body-md text-text-default">Day starts at</span>
              <input
                type="time"
                aria-label="Start of day"
                value={minutesToTimeValue(effectiveStartOfDay)}
                onChange={(e) => void handleStartOfDayChange(e.target.value)}
                disabled={updateStartOfDay.isPending}
                className="rounded-radius-sm border border-border-default bg-surface-default px-3 py-2 text-body-md text-text-default disabled:opacity-60"
              />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span className="text-body-md text-text-default">Day ends at</span>
              <input
                type="time"
                aria-label="End of day"
                value={minutesToTimeValue(effectiveEndOfDay)}
                onChange={(e) => void handleEndOfDayChange(e.target.value)}
                disabled={updateEndOfDay.isPending}
                className="rounded-radius-sm border border-border-default bg-surface-default px-3 py-2 text-body-md text-text-default disabled:opacity-60"
              />
            </label>
          </div>
          <div className="flex flex-col gap-2 border-t border-border-subtle pt-4">
            <div className="flex flex-col gap-0.5">
              <h3 className="text-body-strong text-text-default">Time zone</h3>
              <p className="text-caption text-text-muted">
                Your day and times are shown in {timezoneLabel(effectiveTz)}.
              </p>
            </div>
            <label className="flex items-center justify-between gap-3">
              <span className="text-body-md text-text-default">Time zone</span>
              <select
                aria-label="Time zone"
                value={effectiveTz}
                onChange={(e) => void handleTimezoneChange(e.target.value)}
                disabled={updateTimezone.isPending}
                className="rounded-radius-sm border border-border-default bg-surface-default px-3 py-2 text-body-md text-text-default disabled:opacity-60"
              >
                {US_TIMEZONES.map((z) => (
                  <option key={z.id} value={z.id}>{z.label}</option>
                ))}
                {!US_TIMEZONES.some((z) => z.id === effectiveTz) && (
                  <option value={effectiveTz}>{timezoneLabel(effectiveTz)}</option>
                )}
              </select>
            </label>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
