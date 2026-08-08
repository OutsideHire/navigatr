/**
 * CreateTaskSheet — manually create a follow-up Task.
 *
 * Two modes:
 *   - Deal-bound (dealId given): the task is for that deal, no picker shown.
 *   - Standalone (no dealId, `deals` given): a deal picker is shown.
 *
 * Per the Screen Content Spec §3: the five types are visible at once (not a
 * dropdown) and the fields change with the type:
 *   - Appointment: a REQUIRED start time; no priority; no repeat.
 *   - Drop-in: no time; no priority; no repeat (a timed/priority/recurring
 *     drop-in would corrupt Path routing).
 *   - Call / Email / To-do: an optional reminder time + priority.
 * A live window preview shows the three derived band dates. "Assigned to" shows
 * the current rep (reassigning to another rep is a future feature). Repeat is
 * intentionally omitted everywhere until a recurrence engine exists — a control
 * that silently does nothing would be a false promise.
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { addBusinessDays, differenceInBusinessDays, format, parseISO } from "date-fns";
import { X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { toDateOnly } from "@/lib/calendarDate";
import { Button, FormField, Input, Select, type SelectOption } from "@/components/navigatr";
import { useTaskMutations } from "../hooks/useTaskMutations";
import { bandsFromTarget } from "../lib/taskBands";
import { type TaskType } from "../lib/isProspectTouch";

const TYPES: Array<{ value: TaskType; label: string }> = [
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "drop_in", label: "Drop-in" },
  { value: "appointment", label: "Appointment" },
  { value: "todo", label: "To-do" },
];

const PRIORITY_OPTIONS: SelectOption[] = [
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "low", label: "Low" },
];

const PLACEHOLDER: Record<TaskType, string> = {
  call: "Follow up by phone",
  email: "Send a follow-up email",
  drop_in: "Swing by in person",
  appointment: "Meeting agenda",
  todo: "What needs doing?",
};

// Relative due-date shortcuts, in BUSINESS days (matches how the band interval
// is computed). "Today" is 0.
const DUE_SHORTCUTS: Array<{ label: string; businessDays: number }> = [
  { label: "Today", businessDays: 0 },
  { label: "In 3 days", businessDays: 3 },
  { label: "1 week", businessDays: 5 },
  { label: "2 weeks", businessDays: 10 },
];

const priorityShown = (t: TaskType) => t === "call" || t === "email" || t === "todo";
const timeShown = (t: TaskType) => t !== "drop_in";
const timeRequired = (t: TaskType) => t === "appointment";
const timeLabel = (t: TaskType) => (t === "appointment" ? "Start time" : "Reminder time (optional)");

export interface CreateTaskDealOption {
  id: string;
  companyName: string;
}

export interface CreateTaskSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Deal-bound mode: the task is for this deal (no picker). */
  dealId?: string;
  dealName?: string;
  /** Standalone mode: deals to choose from (a picker is shown). Ignored when
   *  `dealId` is set. */
  deals?: CreateTaskDealOption[];
  /** Preselect a type (e.g. "drop_in" from a Drop-in entry point). */
  defaultType?: TaskType;
}

export function CreateTaskSheet({ open, onOpenChange, dealId, dealName, deals, defaultType }: CreateTaskSheetProps) {
  const { createTask } = useTaskMutations();
  const boundMode = dealId != null;
  const [type, setType] = React.useState<TaskType>(defaultType ?? "call");
  const [title, setTitle] = React.useState(dealName ?? "");
  const [pickedDealId, setPickedDealId] = React.useState<string>("");
  const [dueDate, setDueDate] = React.useState(toDateOnly(new Date()));
  const [time, setTime] = React.useState<string>("");
  const [priority, setPriority] = React.useState<string>("normal");
  const [error, setError] = React.useState<string | null>(null);
  const [dealError, setDealError] = React.useState<string | null>(null);
  const [timeError, setTimeError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setType(defaultType ?? "call");
      setTitle(dealName ?? "");
      setPickedDealId("");
      setDueDate(toDateOnly(new Date()));
      setTime("");
      setPriority("normal");
      setError(null);
      setDealError(null);
      setTimeError(null);
    }
  }, [open, dealName, defaultType]);

  const dealOptions = React.useMemo<SelectOption[]>(
    () => (deals ?? []).map((d) => ({ value: d.id, label: d.companyName })),
    [deals],
  );

  // Live band preview: derive the three dates from today → the chosen due date.
  const bands = React.useMemo(() => {
    const interval = Math.max(
      1,
      differenceInBusinessDays(parseISO(dueDate), parseISO(toDateOnly(new Date()))),
    );
    return bandsFromTarget(dueDate, interval)!;
  }, [dueDate]);

  const setDueRelative = (businessDays: number) =>
    setDueDate(format(addBusinessDays(new Date(), businessDays), "yyyy-MM-dd"));

  const submit = () => {
    let ok = true;
    if (!title.trim()) {
      setError("Title is required");
      ok = false;
    }
    const resolvedDealId = boundMode ? dealId! : pickedDealId || null;
    if (!boundMode && type !== "todo" && !resolvedDealId) {
      setDealError("Pick a deal for this task");
      ok = false;
    }
    if (timeRequired(type) && !time) {
      setTimeError("Start time is required for an appointment");
      ok = false;
    }
    if (!ok) return;

    // Time-of-day maps to start_at for an appointment (a real scheduled start)
    // and to reminder_at for a call/email/to-do (a nudge). Drop-in has no time.
    const iso = timeShown(type) && time ? new Date(`${dueDate}T${time}`).toISOString() : null;
    const startAt = type === "appointment" ? iso : null;
    const reminderAt = type === "appointment" ? null : iso;
    const priorityVal = priorityShown(type) && priority !== "normal" ? priority : null;

    createTask.mutate(
      {
        type,
        title: title.trim(),
        dealId: resolvedDealId,
        targetAt: bands.target_at,
        earliestAt: bands.earliest_at,
        latestAt: bands.latest_at,
        originalTargetAt: bands.target_at,
        dateSource: "interval",
        startAt,
        reminderAt,
        priority: priorityVal,
      },
      {
        onSuccess: () => {
          toast.success("Task created");
          onOpenChange(false);
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create task"),
      },
    );
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "fixed z-50 flex flex-col bg-surface-default text-text-default shadow-card-hover",
            "inset-x-0 bottom-0 max-h-[90dvh] rounded-t-radius-lg",
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-[460px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-radius-lg",
          )}
        >
          <div className="flex shrink-0 items-center justify-between gap-2 px-5 pb-3 pt-5">
            <Dialog.Title className="text-heading-sm text-text-default">Create task</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="inline-flex h-8 w-8 items-center justify-center rounded-radius-sm text-text-muted hover:bg-surface-sunken hover:text-text-default"
              >
                <X className="h-5 w-5" />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex flex-col gap-4 overflow-y-auto px-5 pb-5">
            {/* Type — all five visible at once (per spec, not a dropdown). */}
            <FormField htmlFor="task-type-group" label="Type">
              <div id="task-type-group" role="group" aria-label="Task type" className="flex flex-wrap gap-1.5">
                {TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    aria-pressed={type === t.value}
                    onClick={() => {
                      setType(t.value);
                      setTimeError(null);
                    }}
                    className={cn(
                      "rounded-radius-md border px-3 py-1.5 text-caption font-medium transition-colors",
                      type === t.value
                        ? "border-brand-primary bg-brand-primary/10 text-brand-primary"
                        : "border-border-default text-text-muted hover:text-text-default",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </FormField>

            {/* Deal picker — standalone mode only. Optional for a To-do. */}
            {!boundMode && (
              <FormField
                htmlFor="task-deal"
                label={type === "todo" ? "Deal (optional)" : "Deal"}
                required={type !== "todo"}
                error={dealError ?? undefined}
              >
                <Select
                  id="task-deal"
                  value={pickedDealId}
                  onValueChange={(v) => {
                    setPickedDealId(v);
                    setDealError(null);
                  }}
                  options={dealOptions}
                  placeholder="Select a deal…"
                />
              </FormField>
            )}

            <FormField htmlFor="task-title" label="Title" required error={error ?? undefined}>
              <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={PLACEHOLDER[type]} />
            </FormField>

            {/* Due date + relative shortcuts + live window preview. */}
            <FormField htmlFor="task-due" label="Due date">
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {DUE_SHORTCUTS.map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      onClick={() => setDueRelative(s.businessDays)}
                      className="rounded-radius-md border border-border-default px-2.5 py-1 text-caption text-text-muted transition-colors hover:text-text-default"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <Input id="task-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                <p className="text-caption text-brand-primary tabular-nums">
                  Target {bands.target_at} · earliest {bands.earliest_at} · latest {bands.latest_at} · interval
                </p>
              </div>
            </FormField>

            {/* Time — appointment (required start) / call·email·to-do (optional reminder). */}
            {timeShown(type) && (
              <FormField
                htmlFor="task-time"
                label={timeLabel(type)}
                required={timeRequired(type)}
                error={timeError ?? undefined}
              >
                <Input
                  id="task-time"
                  type="time"
                  value={time}
                  onChange={(e) => {
                    setTime(e.target.value);
                    setTimeError(null);
                  }}
                />
              </FormField>
            )}

            {/* Priority — call/email/to-do only (Path routes drop-in/appointment
                by band urgency, so a manual priority there would fight the router). */}
            {priorityShown(type) && (
              <FormField htmlFor="task-priority" label="Priority">
                <Select id="task-priority" value={priority} onValueChange={setPriority} options={PRIORITY_OPTIONS} />
              </FormField>
            )}

            {/* Assigned to — the current rep for now (reassigning is a future feature). */}
            <FormField htmlFor="task-assignee" label="Assigned to">
              <div
                id="task-assignee"
                className="flex h-10 items-center rounded-radius-md border border-border-default bg-surface-sunken/40 px-3 text-body-md text-text-muted"
              >
                You
              </div>
            </FormField>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border-subtle px-5 py-3">
            <Dialog.Close asChild>
              <Button type="button" variant="tertiary" size="md">Cancel</Button>
            </Dialog.Close>
            <Button type="button" variant="primary" size="md" onClick={submit} loading={createTask.isPending}>
              Create task
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default CreateTaskSheet;
