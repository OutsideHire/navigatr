/**
 * CreateTaskSheet — manually create a follow-up Task from the deal record.
 *
 * SP1 scope: type + title + due date. The due date is the visible target; the
 * band (earliest/latest) is derived around it from the business-day gap to
 * today, and date_source is "interval". Time / repeat / priority fields are
 * deferred (see the SP1 spec); they're optional and rare. A standalone
 * "Add task" with a deal picker on the Activities screen is also deferred.
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

export interface CreateTaskSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  dealName: string;
  /** Preselect a type (e.g. "drop_in" from a Drop-in entry point). */
  defaultType?: TaskType;
}

export function CreateTaskSheet({ open, onOpenChange, dealId, dealName, defaultType }: CreateTaskSheetProps) {
  const { createTask } = useTaskMutations();
  const [type, setType] = React.useState<TaskType>(defaultType ?? "call");
  const [title, setTitle] = React.useState(dealName);
  const [dueDate, setDueDate] = React.useState(toDateOnly(new Date()));
  const [error, setError] = React.useState<string | null>(null);

  // Reset the form each time it opens for a (possibly different) deal.
  React.useEffect(() => {
    if (open) {
      setType(defaultType ?? "call");
      setTitle(dealName);
      setDueDate(toDateOnly(new Date()));
      setError(null);
    }
  }, [open, dealName, defaultType]);

  const submit = () => {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    // Band interval = business-day gap from today to the chosen due date
    // (min 1), treated as the interval per the SP1 spec.
    const interval = Math.max(1, differenceInBusinessDays(parseISO(dueDate), parseISO(toDateOnly(new Date()))));
    const bands = bandsFromTarget(dueDate, interval)!;
    createTask.mutate(
      {
        type,
        title: title.trim(),
        dealId,
        targetAt: bands.target_at,
        earliestAt: bands.earliest_at,
        latestAt: bands.latest_at,
        originalTargetAt: bands.target_at,
        dateSource: "interval",
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

          <div className="flex flex-col gap-4 px-5 pb-5">
            <FormField htmlFor="task-type" label="Type">
              <Select
                id="task-type"
                value={type}
                onValueChange={(v) => setType(v as TaskType)}
                options={TYPE_OPTIONS}
              />
            </FormField>
            <FormField htmlFor="task-title" label="Title" required error={error ?? undefined}>
              <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" />
            </FormField>
            <FormField htmlFor="task-due" label="Due date">
              <Input id="task-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
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
