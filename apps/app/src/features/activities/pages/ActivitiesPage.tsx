/**
 * Activities — the rep's daily action surface.
 *
 * Three tabs:
 *   Today      — overdue + due-today follow-ups, derived from each
 *                activity's followUpDate. Each task is the next-touch
 *                for a deal, computed by the smart follow-up scheduler
 *                when the previous activity was logged.
 *   Upcoming   — next 7 days grouped by day (Mon, Tue, …)
 *   History    — every logged activity, newest first, filterable by
 *                type (call / email / drop_in / appointment)
 *
 * Data: useActivitiesForOrg() + useDeals() (both RLS-scoped to the
 * user's org_id server-side). useLogActivity invalidates both caches
 * on success — there is no client-side mutation here.
 *
 * Mobile-first single column. Desktop centers at max-w-5xl. Each task
 * row exposes a "Log activity" CTA that opens LogActivitySheet
 * pre-filled with the deal id, plus a Snooze menu that pushes the
 * source activity's follow_up_date forward via useUpdateActivity.
 */

import * as React from "react";
import * as Tabs from "@radix-ui/react-tabs";
import {
  Calendar,
  Check as CheckIcon,
  Phone as PhoneIcon,
  PlusCircle,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button, Card, Chip } from "@/components/navigatr";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type Activity, type ActivityType } from "../mockData";
import { type Deal } from "@/features/pipeline/mockData";
import { DISPOSITIONS, formatFollowUpDate } from "@/lib/followUpScheduling";
import { calendarDayDelta } from "@/lib/calendarDate";
import { LogActivitySheet } from "../components/LogActivitySheet";
import { EditActivitySheet } from "../components/EditActivitySheet";
import { CreateTaskSheet } from "../components/CreateTaskSheet";
import { UnloggedCallsSection } from "../components/UnloggedCallsSection";
import { AppointmentsAwaitingOutcome } from "@/features/appointments/components/AppointmentsAwaitingOutcome";
import { useActivitiesForOrg } from "../hooks/useActivities";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import { useTasks } from "../hooks/useTasks";
import { useTaskMutations } from "../hooks/useTaskMutations";
import { type Task } from "../tasks/taskTypes";
import { type TaskType } from "../lib/isProspectTouch";
import { SNOOZE_OPTIONS } from "../lib/snoozeDate";
import {
  ACTIVITY_TYPE_ICON as TYPE_ICON,
  ACTIVITY_TYPE_ACCENT as TYPE_ACCENT,
  ACTIVITY_TYPE_LABEL as TYPE_LABEL,
} from "../lib/activityTypeMeta";

// ── Date helpers ──────────────────────────────────────────────────────

/**
 * Whole-day delta from "now" (its LOCAL day) to a follow-up's calendar day.
 * Shared with the notification bell (lib/calendarDate) so a task buckets to
 * the same day here and in the bell. `now` west of UTC used to bucket against
 * UTC midnight, disagreeing with the bell's local-midnight bell.
 */
function daysBetween(now: Date, dueAt: Date): number {
  return calendarDayDelta(now, dueAt);
}

function formatRelativeShort(iso: string, now: Date): string {
  const d = daysBetween(now, new Date(iso));
  if (d < -1) return `${Math.abs(d)}d overdue`;
  if (d === -1) return "1d overdue";
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  return `Due ${formatFollowUpDate(iso)}`;
}

function formatPastRelative(iso: string, now: Date): string {
  const ms = now.getTime() - new Date(iso).getTime();
  const days = Math.round(ms / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return "over a year ago";
}

function dayHeading(iso: string, now: Date): string {
  const d = daysBetween(now, new Date(iso));
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  // Otherwise "Mon, May 18". timeZone: 'UTC' so the label matches the
  // follow-up's calendar day: dueAt is stored at noon UTC, its UTC day is the
  // intended date, and the Upcoming grouping key is dueAt.slice(0,10) (a UTC
  // date prefix). Rendering in local tz could show the previous day's label
  // under the correct group key for a rep west of UTC.
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// ── Task view model ───────────────────────────────────────────────────

/** The page renders open Task rows (SP1). This is the flattened view a
 *  TaskRow needs; it maps 1:1 from a Task. */
interface PageTask {
  id: string;
  type: TaskType;
  companyName: string;
  dueAt: string; // task.targetAt (YYYY-MM-DD)
  dealId: string | null;
  sourceOutcome: string | null;
  priority: string | null;
  startAt: string | null; // optional time-of-day (ISO)
}

function toPageTask(t: Task): PageTask {
  return {
    id: t.id,
    type: t.type,
    companyName: t.title,
    dueAt: t.targetAt,
    dealId: t.dealId,
    sourceOutcome: t.sourceOutcome,
    priority: t.priority,
    startAt: t.startAt,
  };
}

/** Wall-clock time from an ISO instant, e.g. "2:00 PM". */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** A row in the History tab: a logged activity or a completed to-do, unified
 *  by a sort timestamp. */
type HistoryItem =
  | { kind: "activity"; ts: string; activity: Activity }
  | { kind: "todo"; ts: string; task: Task };

// ── Row components ────────────────────────────────────────────────────


function TaskRow({
  task,
  now,
  onLogOutcome,
  onMarkDone,
  onOpenDeal,
  onSnooze,
  onCancel,
}: {
  task: PageTask;
  now: Date;
  onLogOutcome: (dealId: string) => void;
  onMarkDone: (taskId: string) => void;
  onOpenDeal: (dealId: string) => void;
  onSnooze: (task: PageTask, days: number) => void;
  onCancel: (taskId: string) => void;
}) {
  const overdue = daysBetween(now, new Date(task.dueAt)) < 0;
  const isTodo = task.type === "todo";
  const Icon = isTodo ? CheckIcon : TYPE_ICON[task.type as ActivityType];
  const accent = isTodo
    ? { bg: "bg-surface-sunken", fg: "text-text-muted" }
    : TYPE_ACCENT[task.type as ActivityType];
  const outcomeLabel = task.sourceOutcome
    ? DISPOSITIONS[task.sourceOutcome as keyof typeof DISPOSITIONS]?.label
    : undefined;

  // Primary action varies by type: log the outcome (call/email/appointment),
  // mark done (to-do, internal), or open the deal to log off-route (drop-in).
  const primary =
    isTodo
      ? { label: "Mark done", run: () => onMarkDone(task.id) }
      : task.type === "drop_in"
        ? { label: "Open deal", run: () => task.dealId && onOpenDeal(task.dealId) }
        : { label: "Log activity", run: () => task.dealId && onLogOutcome(task.dealId) };

  return (
    <div
      data-testid="task-row"
      className={cn(
        "flex flex-col gap-3 rounded-radius-md border p-4 transition-colors sm:flex-row sm:items-center sm:justify-between",
        overdue
          ? "border-status-danger/30 bg-status-danger-bg/50"
          : "border-border-subtle bg-surface-default",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-radius-full",
            overdue ? "bg-status-danger text-text-inverse" : cn(accent.bg, accent.fg),
          )}
          aria-hidden
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="flex items-center gap-1.5 text-body-strong text-text-default">
            <span className="truncate">{task.companyName}</span>
            {task.priority === "high" && (
              <span className="inline-flex shrink-0 items-center rounded-radius-full bg-status-danger-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-status-danger">
                High
              </span>
            )}
          </p>
          <p className="text-caption text-text-muted">
            <span className={overdue ? "font-medium text-status-danger" : "text-text-default"}>
              {formatRelativeShort(task.dueAt, now)}
            </span>
            {task.startAt ? <>{" · "}{formatTime(task.startAt)}</> : null}
            {outcomeLabel ? <>{" · "}from {outcomeLabel}</> : null}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-2 self-stretch sm:self-auto">
        <Button
          variant="primary"
          size="sm"
          leadingIcon={isTodo ? CheckIcon : PlusCircle}
          onClick={primary.run}
          className="flex-1 sm:flex-none"
        >
          {primary.label}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="tertiary" size="sm">
              Snooze
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {SNOOZE_OPTIONS.map((opt) => (
              <DropdownMenuItem key={opt.value} onSelect={() => onSnooze(task, opt.days)}>
                {opt.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onSelect={() => onCancel(task.id)} className="text-status-danger">
              Cancel follow-up
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function HistoryRow({
  activity,
  deal,
  now,
  onEdit,
}: {
  activity: Activity;
  deal: Deal | undefined;
  now: Date;
  onEdit: (a: Activity) => void;
}) {
  const Icon = TYPE_ICON[activity.type];
  const accent = TYPE_ACCENT[activity.type];
  const dispoLabel = DISPOSITIONS[activity.disposition].label;
  const subtitle = [
    activity.durationMinutes ? `${activity.durationMinutes} min` : null,
    dispoLabel,
  ].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      onClick={() => onEdit(activity)}
      aria-label={`Edit ${TYPE_LABEL[activity.type]} activity`}
      className={cn(
        "flex w-full items-start gap-3 rounded-radius-md border border-border-subtle bg-surface-default p-4 text-left transition-colors",
        "hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas",
      )}
    >
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-radius-full", accent.bg, accent.fg)} aria-hidden>
        <Icon className="h-4 w-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="truncate text-body-strong text-text-default">
          {TYPE_LABEL[activity.type]} · {deal?.companyName ?? "Unknown deal"}
        </p>
        <p className="truncate text-caption text-text-muted">{subtitle}</p>
        {activity.outcomeNotes && (
          <p className="line-clamp-2 text-caption text-text-default">{activity.outcomeNotes}</p>
        )}
      </div>
      <span className="shrink-0 text-caption tabular-nums text-text-muted">
        {formatPastRelative(activity.occurredAt, now)}
      </span>
    </button>
  );
}

/** A completed to-do in the History list. To-dos aren't activities, so they
 *  don't come through the activities feed; we render them alongside so a rep
 *  can see what they finished, not just what vanished. */
function TodoHistoryRow({ task, now }: { task: Task; now: Date }) {
  return (
    <div className="flex w-full items-start gap-3 rounded-radius-md border border-border-subtle bg-surface-default p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-radius-full bg-status-success-bg text-status-success" aria-hidden>
        <CheckIcon className="h-4 w-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="truncate text-body-strong text-text-default">To-do · {task.title}</p>
        <p className="truncate text-caption text-text-muted">Completed</p>
      </div>
      <span className="shrink-0 text-caption tabular-nums text-text-muted">
        {task.completedAt ? formatPastRelative(task.completedAt, now) : ""}
      </span>
    </div>
  );
}

// ── Empty states ──────────────────────────────────────────────────────

function EmptyTodayCard() {
  return (
    <Card padding="lg" className="flex flex-col items-center gap-3 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-status-success-bg text-status-success">
        <CheckIcon className="h-6 w-6" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-body-strong text-text-default">All caught up</p>
        <p className="text-caption text-text-muted">No tasks due today. Time to find new prospects.</p>
      </div>
    </Card>
  );
}

function EmptyUpcomingCard() {
  return (
    <Card padding="lg" className="flex flex-col items-center gap-3 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
        <Calendar className="h-6 w-6" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-body-strong text-text-default">No upcoming tasks</p>
        <p className="text-caption text-text-muted">
          Log an activity from any deal to schedule the next touch.
        </p>
      </div>
    </Card>
  );
}

function EmptyHistoryCard() {
  const navigate = useNavigate();
  return (
    <Card padding="lg" className="flex flex-col items-center gap-3 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
        <PhoneIcon className="h-6 w-6" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-body-strong text-text-default">No activities logged yet</p>
        <p className="text-caption text-text-muted">
          Log your first call from any deal in the Pipeline.
        </p>
      </div>
      <Button variant="primary" size="sm" onClick={() => navigate("/pipeline")}>
        Go to Pipeline
      </Button>
    </Card>
  );
}

// Shown when an active type filter leaves a tab empty — distinct from the
// natural "all caught up" empties, which would mislead under a filter.
function FilteredEmptyCard({ typeLabel, onClear }: { typeLabel: string; onClear: () => void }) {
  return (
    <Card padding="lg" className="flex flex-col items-center gap-2 text-center">
      <p className="text-body-strong text-text-default">No {typeLabel} here</p>
      <p className="text-caption text-text-muted">Nothing matches this type filter.</p>
      <Button variant="tertiary" size="sm" onClick={onClear}>
        Clear filter
      </Button>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────

const TYPE_FILTERS: Array<"all" | TaskType> = ["all", "call", "email", "drop_in", "appointment", "todo"];

function typeFilterLabel(f: "all" | TaskType): string {
  if (f === "all") return "All";
  if (f === "todo") return "To-do";
  return TYPE_LABEL[f];
}

export function ActivitiesPage() {
  const [tab, setTab] = React.useState<"today" | "upcoming" | "history">("today");
  const [typeFilter, setTypeFilter] = React.useState<"all" | TaskType>("all");
  const [logSheetDealId, setLogSheetDealId] = React.useState<string | null>(null);
  const [logSheetOpen, setLogSheetOpen] = React.useState(false);
  const [editingActivity, setEditingActivity] = React.useState<Activity | null>(null);
  const [createTaskOpen, setCreateTaskOpen] = React.useState(false);

  // Pin "now" once per mount so the bucketing doesn't drift mid-session.
  // TODO: re-pin on tab visibility change so a rep who leaves the app
  // open overnight gets a fresh "today" on next focus.
  const now = React.useMemo(() => new Date(), []);

  // Live data. Tasks drive Today/Upcoming (the follow-up primitive); History
  // still reads activities. useLogActivity + the task mutations invalidate the
  // relevant caches on success, so rows surface without a refreshKey hack.
  const { tasks: openTasks } = useTasks("open");
  const { tasks: completedTasks } = useTasks("completed");
  const { data: activities = [] } = useActivitiesForOrg();
  const { data: deals = [] } = useDeals();
  const { completeTask, cancelTask, snoozeTask } = useTaskMutations();
  const navigate = useNavigate();

  const dealById = React.useMemo(
    () => new Map(deals.map((d) => [d.id, d])),
    [deals],
  );

  // Keep the full Task objects addressable by id (snooze needs the band dates).
  const taskById = React.useMemo(
    () => new Map(openTasks.map((t) => [t.id, t])),
    [openTasks],
  );

  const pageTasks = React.useMemo(() => openTasks.map(toPageTask), [openTasks]);

  // The shared type filter applies to Today/Upcoming too.
  const visibleTasks = React.useMemo(
    () => (typeFilter === "all" ? pageTasks : pageTasks.filter((t) => t.type === typeFilter)),
    [pageTasks, typeFilter],
  );

  const { overdue, today, upcoming } = React.useMemo(() => {
    const groups = { overdue: [] as PageTask[], today: [] as PageTask[], upcoming: [] as PageTask[] };
    for (const t of visibleTasks) {
      const delta = daysBetween(now, new Date(t.dueAt));
      if (delta < 0) groups.overdue.push(t);
      else if (delta === 0) groups.today.push(t);
      else if (delta <= 7) groups.upcoming.push(t);
      // beyond 7 days = ignored (out of view for sprint 1)
    }
    return groups;
  }, [visibleTasks, now]);

  // Group upcoming by day so the UI renders day-headed buckets.
  const upcomingByDay = React.useMemo(() => {
    const map = new Map<string, PageTask[]>();
    for (const t of upcoming) {
      const key = t.dueAt.slice(0, 10); // YYYY-MM-DD
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [upcoming]);

  // Completed to-dos surface in History alongside activities so finished work
  // doesn't just vanish. (To-dos aren't activities, so they don't come through
  // the activities feed.)
  const completedTodos = React.useMemo(
    () => completedTasks.filter((t) => t.type === "todo" && t.completedAt),
    [completedTasks],
  );

  // History — most recent first, filtered by type. Activities + completed
  // to-dos merged into one time-ordered list. The activities query already
  // orders desc; we re-sort the merged set on the shared timestamp.
  const historyItems = React.useMemo<HistoryItem[]>(() => {
    const acts: HistoryItem[] =
      typeFilter === "todo"
        ? []
        : activities
            .filter((a) => typeFilter === "all" || a.type === typeFilter)
            .map((a) => ({ kind: "activity", ts: a.occurredAt, activity: a }));
    const todos: HistoryItem[] =
      typeFilter === "all" || typeFilter === "todo"
        ? completedTodos.map((t) => ({ kind: "todo", ts: t.completedAt as string, task: t }))
        : [];
    return [...acts, ...todos].sort((a, b) => b.ts.localeCompare(a.ts));
  }, [activities, completedTodos, typeFilter]);

  const openLogSheet = (dealId: string) => {
    setLogSheetDealId(dealId);
    setLogSheetOpen(true);
  };

  const handleSnooze = (task: PageTask, days: number) => {
    const full = taskById.get(task.id);
    if (!full) return;
    snoozeTask.mutate(
      { task: full, businessDays: days },
      {
        onSuccess: () => toast.success("Snoozed"),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not snooze"),
      },
    );
  };

  const handleMarkDone = (taskId: string) => {
    completeTask.mutate(taskId, {
      onSuccess: () => toast.success("Marked done"),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Could not complete"),
    });
  };

  const handleCancel = (taskId: string) => {
    cancelTask.mutate(taskId, {
      onSuccess: () => toast.success("Follow-up cancelled"),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Could not cancel"),
    });
  };

  const handleOpenDeal = (dealId: string) => navigate(`/pipeline/${dealId}`);

  // Tab counts so the header chips show real numbers.
  const todayCount = overdue.length + today.length;
  const upcomingCount = upcoming.length;
  const historyCount = historyItems.length;

  return (
    <div className="mx-auto w-full px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="flex flex-col gap-4 lg:gap-6">
        {/* Header */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-heading-lg text-text-default">Activities</h1>
            <p className="text-body-md text-text-muted">
              {todayCount === 0
                ? "No tasks due today"
                : `${todayCount} ${todayCount === 1 ? "task" : "tasks"} due today`}
              {overdue.length > 0 && (
                <> · <span className="font-medium text-status-danger">{overdue.length} overdue</span></>
              )}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={PlusCircle}
            onClick={() => setCreateTaskOpen(true)}
            className="self-start"
          >
            New task
          </Button>
        </header>

        <UnloggedCallsSection />

        <AppointmentsAwaitingOutcome />

        {/* Shared type filter — applies across all three tabs and persists
            across tab switches. No per-type counts here (a single number
            can't represent the three views); the tab triggers carry counts. */}
        <div
          className={cn(
            "flex gap-2 overflow-x-auto pb-1",
            "[&::-webkit-scrollbar]:hidden",
            "[-ms-overflow-style:none] [scrollbar-width:none]",
          )}
          aria-label="Filter by activity type"
        >
          {TYPE_FILTERS.map((f) => (
            <Chip key={f} active={typeFilter === f} onClick={() => setTypeFilter(f)}>
              {typeFilterLabel(f)}
            </Chip>
          ))}
        </div>

        <Tabs.Root value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <Tabs.List
            className={cn(
              "flex gap-1 overflow-x-auto border-b border-border-subtle",
              "[&::-webkit-scrollbar]:hidden",
              "[-ms-overflow-style:none] [scrollbar-width:none]",
            )}
            aria-label="Activity sections"
          >
            {(["today", "upcoming", "history"] as const).map((key) => {
              const label = key === "today" ? "Today" : key === "upcoming" ? "Upcoming" : "History";
              const count = key === "today" ? todayCount : key === "upcoming" ? upcomingCount : historyCount;
              return (
                <Tabs.Trigger
                  key={key}
                  value={key}
                  className={cn(
                    "relative shrink-0 px-3 py-2 text-body-md font-medium transition-colors",
                    "text-text-muted hover:bg-surface-elevated hover:text-text-default",
                    "data-[state=active]:text-text-default",
                    "data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:bottom-[-1px] data-[state=active]:after:h-0.5 data-[state=active]:after:bg-brand-primary",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas",
                  )}
                >
                  {label}
                  {count > 0 && (
                    <span className="ml-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-radius-full bg-surface-sunken px-1 text-[10px] font-semibold tabular-nums text-text-default">
                      {count}
                    </span>
                  )}
                </Tabs.Trigger>
              );
            })}
          </Tabs.List>

          {/* Today */}
          <Tabs.Content value="today" className="mt-4 focus-visible:outline-none">
            {todayCount === 0 ? (
              typeFilter !== "all" ? (
                <FilteredEmptyCard typeLabel={typeFilterLabel(typeFilter)} onClear={() => setTypeFilter("all")} />
              ) : (
                <EmptyTodayCard />
              )
            ) : (
              <div className="flex flex-col gap-4">
                {overdue.length > 0 && (
                  <section className="flex flex-col gap-2">
                    <p className="text-eyebrow text-status-danger">Overdue · {overdue.length}</p>
                    <div className="flex flex-col gap-2">
                      {overdue.map((t) => (
                        <TaskRow key={t.id} task={t} now={now} onLogOutcome={openLogSheet} onMarkDone={handleMarkDone} onOpenDeal={handleOpenDeal} onSnooze={handleSnooze} onCancel={handleCancel} />
                      ))}
                    </div>
                  </section>
                )}
                {today.length > 0 && (
                  <section className="flex flex-col gap-2">
                    <p className="text-eyebrow text-text-subtle">Due today · {today.length}</p>
                    <div className="flex flex-col gap-2">
                      {today.map((t) => (
                        <TaskRow key={t.id} task={t} now={now} onLogOutcome={openLogSheet} onMarkDone={handleMarkDone} onOpenDeal={handleOpenDeal} onSnooze={handleSnooze} onCancel={handleCancel} />
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </Tabs.Content>

          {/* Upcoming */}
          <Tabs.Content value="upcoming" className="mt-4 focus-visible:outline-none">
            {upcoming.length === 0 ? (
              typeFilter !== "all" ? (
                <FilteredEmptyCard typeLabel={typeFilterLabel(typeFilter)} onClear={() => setTypeFilter("all")} />
              ) : (
                <EmptyUpcomingCard />
              )
            ) : (
              <div className="flex flex-col gap-4">
                {upcomingByDay.map(([dateKey, items]) => (
                  <section key={dateKey} className="flex flex-col gap-2">
                    <p className="text-eyebrow text-text-subtle">{dayHeading(items[0]!.dueAt, now)}</p>
                    <div className="flex flex-col gap-2">
                      {items.map((t) => (
                        <TaskRow key={t.id} task={t} now={now} onLogOutcome={openLogSheet} onMarkDone={handleMarkDone} onOpenDeal={handleOpenDeal} onSnooze={handleSnooze} onCancel={handleCancel} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </Tabs.Content>

          {/* History */}
          <Tabs.Content value="history" className="mt-4 focus-visible:outline-none">
            <div className="flex flex-col gap-3">
              {historyItems.length === 0 ? (
                activities.length === 0 && completedTodos.length === 0 ? (
                  <EmptyHistoryCard />
                ) : (
                  <FilteredEmptyCard typeLabel={typeFilterLabel(typeFilter)} onClear={() => setTypeFilter("all")} />
                )
              ) : (
                <div className="flex flex-col gap-2">
                  {historyItems.map((item) =>
                    item.kind === "activity" ? (
                      <HistoryRow
                        key={`a-${item.activity.id}`}
                        activity={item.activity}
                        deal={dealById.get(item.activity.dealId)}
                        now={now}
                        onEdit={setEditingActivity}
                      />
                    ) : (
                      <TodoHistoryRow key={`t-${item.task.id}`} task={item.task} now={now} />
                    ),
                  )}
                </div>
              )}
            </div>
          </Tabs.Content>
        </Tabs.Root>
      </div>

      {logSheetDealId && (
        <LogActivitySheet
          open={logSheetOpen}
          onOpenChange={setLogSheetOpen}
          dealId={logSheetDealId}
          onLogged={() => {
            // The sheet's own toast already fires. useLogActivity
            // invalidates both ACTIVITIES_ORG_QUERY_KEY and the deals
            // list cache — the tabs refetch automatically.
            toast.success("Activity logged");
          }}
        />
      )}

      {editingActivity && (
        <EditActivitySheet
          open={!!editingActivity}
          onOpenChange={(open) => !open && setEditingActivity(null)}
          activity={editingActivity}
        />
      )}

      <CreateTaskSheet
        open={createTaskOpen}
        onOpenChange={setCreateTaskOpen}
        deals={deals.map((d) => ({ id: d.id, companyName: d.companyName }))}
      />
    </div>
  );
}

export default ActivitiesPage;
