/**
 * CreateTaskSheet — manually create a follow-up Task.
 *
 * Two modes:
 *   - Deal-bound (dealId given): the task is for that deal, no picker shown.
 *     Used from the deal record's quick actions.
 *   - Standalone (no dealId, `deals` given): a deal picker is shown. Used from
 *     the Activities header so a rep can create a task without opening a deal
 *     first. A "To-do" needs no deal; every other type does (the DB requires it).
 *
 * Fields: type + title + due date, plus optional time-of-day and priority. The
 * due date is the visible target; the band (earliest/latest) is derived around
 * it from the business-day gap to today, and date_source is "interval". Repeat
 * is intentionally omitted: nothing honours a recurrence rule yet, so offering
 * one would be a promise the app can't keep.
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { differenceInBusinessDays, parseISO } from "date-fns";
import { X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { toDateOnly } from "@/lib/calendarDate";
import { Button, FormField, Input, Select, type SelectOption } from "@/components/navigatr";
import { useTaskMutations } from "../hooks/useTaskMutations";
import { bandsFromTarget } from "../lib/taskBands";
import { type TaskType } from "../lib/isProspectTouch";

const TYPE_OPTIONS: SelectOption[] = [
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

  // Reset the form each time it opens for a (possibly different) deal.
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
    }
  }, [open, dealName, defaultType]);

  const dealOptions = React.useMemo<SelectOption[]>(
    () => (deals ?? []).map((d) => ({ value: d.id, label: d.companyName })),
    [deals],
  );

  const submit = () => {
    let ok = true;
    if (!title.trim()) {
      setError("Title is required");
      ok = false;
    }
    // Resolve the deal: bound mode uses the prop; standalone uses the picker.
    // Every type except "todo" requires a deal (the DB enforces this too).
    const resolvedDealId = boundMode ? dealId! : pickedDealId || null;
    if (!boundMode && type !== "todo" && !resolvedDealId) {
      setDealError("Pick a deal for this task");
      ok = false;
    }
    if (!ok) return;

    // Band interval = business-day gap from today to the chosen due date
    // (min 1), treated as the interval per the SP1 spec.
    const interval = Math.max(1, differenceInBusinessDays(parseISO(dueDate), parseISO(toDateOnly(new Date()))));
    const bands = bandsFromTarget(dueDate, interval)!;
    // Optional time-of-day → start_at (local wall-clock on the due date).
    const startAt = time ? new Date(`${dueDate}T${time}`).toISOString() : null;
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
        priority: priority === "normal" ? null : priority,
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
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-[440px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-radius-lg",
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
            <FormField htmlFor="task-type" label="Type">
              <Select
                id="task-type"
                value={type}
                onValueChange={(v) => setType(v as TaskType)}
                options={TYPE_OPTIONS}
              />
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
              <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" />
            </FormField>

            <div className="flex gap-3">
              <FormField htmlFor="task-due" label="Due date" className="flex-1">
                <Input id="task-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </FormField>
              <FormField htmlFor="task-time" label="Time (optional)" className="flex-1">
                <Input id="task-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </FormField>
            </div>

            <FormField htmlFor="task-priority" label="Priority">
              <Select
                id="task-priority"
                value={priority}
                onValueChange={setPriority}
                options={PRIORITY_OPTIONS}
              />
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
