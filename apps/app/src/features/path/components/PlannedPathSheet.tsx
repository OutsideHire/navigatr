/**
 * PlannedPathSheet: view and edit a planned path from "Upcoming paths".
 *
 * Opened by UpcomingPaths' Open for one specific path. Same right-hand slide-out
 * pattern as PlanPathWizard (Radix Dialog). Shows the path's name, day, reminder,
 * a map of its stops and the ordered stop list, and lets the rep:
 *   - remove a stop or move it up / down (saved straight away),
 *   - rename it, move it to another day (today or later) or change the reminder
 *     (saved with "Save changes", then the calendar block is re-synced, same as
 *     the Plan a Path save site),
 *   - delete the whole path (with a confirm).
 *
 * Rules:
 *   - One path per day (paths is unique on user_id + path_date). Picking a day
 *     that already has a path shows "You already have a path on that day." and
 *     changes nothing (checked against the cached list, and the database's
 *     unique violation is mapped to the same message). Moving to a today whose
 *     row has no stops says "Today already has a path. Add stops from there."
 *   - Removing the LAST stop is not allowed on its own: a path with no stops is
 *     an empty Upcoming row. Instead the sheet offers to delete the whole path.
 *   - Moving the path to today closes the sheet and the parent lands on today's
 *     route (onMovedToToday).
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowDown, ArrowUp, Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/navigatr";
import type { Merchant, MerchantCategory } from "../mockData";
import type { Path, PathStop } from "../lib/pathTypes";
import { useActivePath } from "../hooks/useActivePath";
import { usePaths } from "../hooks/usePaths";
import { usePathMutations, isDuplicatePathDayError } from "../hooks/usePathMutations";
import { usePathCalendarSync } from "../hooks/usePathCalendarSync";
import { todayISO, addDaysISO, formatPathDate } from "../lib/today";
import { composeReminderAt, formatReminder, isTodayOrFuture, nextMondayISO } from "../lib/scheduleDate";
import { PlanScheduleStep, type DateQuickPick } from "./plan/PlanScheduleStep";
import { MerchantMap } from "./MerchantMap";

const DUPLICATE_DAY_MESSAGE = "You already have a path on that day.";
const TODAY_HAS_ROUTE_MESSAGE = "Today already has a path. Add stops from there.";

export interface PlannedPathSheetProps {
  /** The path to show. Null keeps the sheet closed. */
  path: Path | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The rep moved this path to today: the parent should show today's route. */
  onMovedToToday: () => void;
}

export function PlannedPathSheet({ path, open, onOpenChange, onMovedToToday }: PlannedPathSheetProps) {
  return (
    <Dialog.Root open={open && path != null} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-md flex-col bg-surface-default shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right md:max-w-[28rem]"
        >
          {path && (
            <PlannedPathBody
              key={path.id}
              path={path}
              onClose={() => onOpenChange(false)}
              onMovedToToday={onMovedToToday}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Local "HH:MM" of a reminder timestamp, or "" when there is none. */
function reminderTimeOf(reminderAt: string | null): string {
  if (!reminderAt) return "";
  const d = new Date(reminderAt);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Which quick-pick a date corresponds to (drives the highlighted button). */
function pickFor(iso: string): DateQuickPick {
  const today = todayISO();
  if (iso === today) return "today";
  if (iso === addDaysISO(today, 1)) return "tomorrow";
  if (iso === nextMondayISO(today)) return "next_week";
  return "custom";
}

/** A stop snapshot shaped for MerchantMap (it reads id/name/lat/lng/category). */
function stopAsMerchant(s: PathStop): Merchant {
  return {
    id: s.id,
    name: s.name,
    address: s.address ?? "",
    lat: s.lat,
    lng: s.lng,
    category: s.category as MerchantCategory,
    // MerchantMap colors pins by status; a planned stop is a prospect.
    status: "prospect",
  } as Merchant;
}

type Confirm = null | "delete" | "last-stop";

function PlannedPathBody({
  path,
  onClose,
  onMovedToToday,
}: {
  path: Path;
  onClose: () => void;
  onMovedToToday: () => void;
}) {
  // What is saved right now (updated after a successful save so the header and
  // the stop query follow a moved day without waiting on a refetch).
  const [saved, setSaved] = React.useState({
    name: path.name,
    date: path.date,
    reminderAt: path.reminderAt,
  });

  // Draft details.
  const [name, setName] = React.useState(path.name ?? "");
  const [date, setDate] = React.useState(path.date);
  const [reminderTime, setReminderTime] = React.useState(reminderTimeOf(path.reminderAt));
  const [error, setError] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<Confirm>(null);
  const [busy, setBusy] = React.useState(false);
  // A remove / reorder is in flight (tracked locally so the whole sheet locks
  // even before the mutation's own pending flag settles).
  const [stopEditing, setStopEditing] = React.useState(false);

  const { data: active, isLoading: stopsLoading, isFetching: stopsFetching } = useActivePath(saved.date);
  const stops = React.useMemo(() => active?.stops ?? [], [active]);
  const { data: allPaths = [] } = usePaths();
  const { updatePath, removeStop, reorderStops, deletePlannedPath } = usePathMutations();
  const { syncPath } = usePathCalendarSync();

  const dateValid = isTodayOrFuture(date);
  const savedTime = reminderTimeOf(saved.reminderAt);
  const dirty = name.trim() !== (saved.name ?? "") || date !== saved.date || reminderTime !== savedTime;
  const stopsBusy = stopEditing || removeStop.isPending || reorderStops.isPending;
  // Stop buttons lock while anything is saving. Move also waits for the stop
  // list to refetch, so a second move never reorders a stale list.
  const stopButtonsLocked = stopsBusy || busy;
  const moveLocked = stopButtonsLocked || Boolean(stopsFetching);

  const displayName = saved.name ?? path.originLabel ?? "Planned path";
  const reminderLabel = formatReminder(saved.reminderAt);
  const stopCount = active ? stops.length : path.stopCount;

  const mapMerchants = React.useMemo(() => stops.map(stopAsMerchant), [stops]);
  const routePath = React.useMemo(() => stops.map((s) => ({ lat: s.lat, lng: s.lng })), [stops]);
  const mapCenter =
    path.originLat != null && path.originLng != null
      ? { lat: path.originLat, lng: path.originLng }
      : stops[0]
        ? { lat: stops[0].lat, lng: stops[0].lng }
        : null;

  const handleDateChange = React.useCallback((iso: string) => {
    setDate(iso);
    setError(null);
  }, []);

  const handleSave = React.useCallback(async () => {
    if (!dirty || !dateValid || busy || stopsBusy) return;
    // One path per day: catch it from the cached list before writing anything.
    const clash = date !== saved.date ? allPaths.find((p) => p.id !== path.id && p.date === date) : undefined;
    if (clash) {
      // Today's row with no stops is usually an auto-created day: point the rep
      // to Path to add stops there instead of a bare "already have" message.
      setError(date === todayISO() && clash.stopCount === 0 ? TODAY_HAS_ROUTE_MESSAGE : DUPLICATE_DAY_MESSAGE);
      return;
    }
    const nextName = name.trim() === "" ? null : name.trim();
    const nextReminder = composeReminderAt(date, reminderTime);
    setBusy(true);
    setError(null);
    try {
      await updatePath.mutateAsync({ pathId: path.id, name: nextName, date, reminderAt: nextReminder });
    } catch (err) {
      setError(isDuplicatePathDayError(err) ? DUPLICATE_DAY_MESSAGE : "Couldn't save. Try again.");
      setBusy(false);
      return;
    }
    // Saved: move the calendar block to match. Fire-and-forget, like Plan a Path.
    void syncPath(path.id);
    setSaved({ name: nextName, date, reminderAt: nextReminder });
    setName(nextName ?? "");
    setBusy(false);
    if (date === todayISO()) {
      onMovedToToday();
      return;
    }
    toast.success("Path updated");
  }, [dirty, dateValid, busy, stopsBusy, date, saved.date, allPaths, path.id, name, reminderTime, updatePath, syncPath, onMovedToToday]);

  const handleRemove = React.useCallback(
    async (s: PathStop) => {
      if (stops.length <= 1) {
        setConfirm("last-stop");
        return;
      }
      setStopEditing(true);
      try {
        await removeStop.mutateAsync(s.id);
      } catch {
        toast.error("Couldn't remove the stop. Try again.");
      } finally {
        setStopEditing(false);
      }
    },
    [stops.length, removeStop],
  );

  const handleMove = React.useCallback(
    async (index: number, direction: "up" | "down") => {
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= stops.length) return;
      const ids = stops.map((s) => s.id);
      [ids[index], ids[target]] = [ids[target]!, ids[index]!];
      setStopEditing(true);
      try {
        await reorderStops.mutateAsync({ orderedStopIds: ids });
      } catch {
        toast.error("Couldn't reorder. Try again.");
      } finally {
        setStopEditing(false);
      }
    },
    [stops, reorderStops],
  );

  const handleDelete = React.useCallback(async () => {
    setBusy(true);
    try {
      // The mutation reads the calendar block fresh from the row.
      await deletePlannedPath.mutateAsync(path.id);
      toast.success("Path deleted");
      onClose();
    } catch {
      toast.error("Couldn't delete the path. Try again.");
      setBusy(false);
    }
  }, [deletePlannedPath, path.id, onClose]);

  return (
    <>
      {/* Header */}
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border-default px-5 py-4">
        <div className="flex min-w-0 flex-col gap-1">
          <Dialog.Title asChild>
            <h2 className="truncate text-heading-sm text-text-default">{displayName}</h2>
          </Dialog.Title>
          <p className="text-caption text-text-muted">
            {formatPathDate(saved.date)}
            {reminderLabel ? ` · Reminder ${reminderLabel}` : ""}
            {` · ${stopCount} ${stopCount === 1 ? "stop" : "stops"}`}
          </p>
        </div>
        <Dialog.Close asChild>
          <button
            type="button"
            aria-label="Close"
            className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-radius-sm text-text-muted hover:text-text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </Dialog.Close>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="flex flex-col gap-5">
          {mapCenter && stops.length > 0 && (
            <div className="h-44 w-full overflow-hidden rounded-radius-md">
              <MerchantMap
                position={mapCenter}
                merchants={mapMerchants}
                routePath={routePath}
                showPosition={false}
                fitToMerchants
              />
            </div>
          )}

          <section className="flex flex-col gap-2">
            <h3 className="text-label text-text-default">Stops</h3>
            {stopsLoading && !active ? (
              <p className="flex items-center gap-2 text-body-md text-text-muted">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading stops
              </p>
            ) : stops.length === 0 ? (
              <p className="text-body-md text-text-muted">No stops on this path.</p>
            ) : (
              <ol aria-label="Stops" className="flex flex-col rounded-radius-md border border-border-default">
                {stops.map((s, i) => (
                  <li
                    key={s.id}
                    className="flex items-center gap-2 py-1 pl-3 pr-1 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-border-subtle"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-radius-full bg-surface-sunken text-caption font-semibold tabular-nums text-text-default">
                      {i + 1}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-body-strong text-text-default">{s.name}</span>
                      {s.address && <span className="truncate text-caption text-text-muted">{s.address}</span>}
                    </div>
                    <div className="flex shrink-0 items-center">
                      <IconButton
                        label={`Move ${s.name} up`}
                        onClick={() => void handleMove(i, "up")}
                        disabled={i === 0 || moveLocked}
                      >
                        <ArrowUp className="h-4 w-4" aria-hidden />
                      </IconButton>
                      <IconButton
                        label={`Move ${s.name} down`}
                        onClick={() => void handleMove(i, "down")}
                        disabled={i === stops.length - 1 || moveLocked}
                      >
                        <ArrowDown className="h-4 w-4" aria-hidden />
                      </IconButton>
                      <IconButton
                        label={`Remove ${s.name}`}
                        onClick={() => void handleRemove(s)}
                        disabled={stopButtonsLocked}
                        danger
                      >
                        <X className="h-4 w-4" aria-hidden />
                      </IconButton>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <PlanScheduleStep
            date={date}
            onDateChange={(iso) => handleDateChange(iso)}
            activePick={pickFor(date)}
            reminderTime={reminderTime}
            onReminderTimeChange={(t) => {
              setReminderTime(t);
              setError(null);
            }}
            name={name}
            onNameChange={(n) => {
              setName(n);
              setError(null);
            }}
            dateValid={dateValid}
            title="When"
            description="Move it to another day or change the reminder."
            headingLevel="h3"
          />

          {confirm === null && (
            <Button
              variant="tertiary"
              size="lg"
              leadingIcon={Trash2}
              onClick={() => setConfirm("delete")}
              className="self-start text-status-danger"
            >
              Delete path
            </Button>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="flex shrink-0 flex-col gap-3 border-t border-border-default px-5 py-4">
        {confirm !== null ? (
          <div role="alertdialog" aria-label="Delete path" className="flex flex-col gap-3">
            <p className="text-body-md text-text-default">
              {confirm === "last-stop"
                ? "This is the last stop. Delete the whole path?"
                : "Delete this path? This can't be undone."}
            </p>
            <div className="flex gap-3">
              <Button variant="secondary" size="lg" fullWidth onClick={() => setConfirm(null)} disabled={busy}>
                Keep it
              </Button>
              <Button variant="destructive" size="lg" fullWidth onClick={() => void handleDelete()} loading={busy}>
                Delete
              </Button>
            </div>
          </div>
        ) : (
          <>
            {error && (
              <p role="alert" className="text-body-md text-status-danger">
                {error}
              </p>
            )}
            <Button
              variant="primary"
              size="lg"
              fullWidth
              disabled={!dirty || !dateValid || busy || stopsBusy}
              loading={busy}
              onClick={() => void handleSave()}
            >
              Save changes
            </Button>
          </>
        )}
      </footer>
    </>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={
        "flex h-11 w-11 items-center justify-center rounded-radius-sm text-text-muted disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary " +
        (danger ? "hover:text-status-danger" : "hover:text-text-default")
      }
    >
      {children}
    </button>
  );
}

export default PlannedPathSheet;
