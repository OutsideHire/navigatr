/**
 * PlanScheduleStep — step 5 of the Plan-a-Path wizard (SP3).
 *
 * The rep picks WHEN the planned path should run and an optional in-app reminder,
 * plus a human name. Continue (in the parent shell) performs the save
 * (createPath with this date + name + reminder_at, then addStops) — this
 * component is presentational: it renders the controls and reports changes up.
 *
 * Date quick-picks: Today / Tomorrow / Next week (= next Monday) / a raw date
 * input. Default is Tomorrow ("prep tomorrow's route"). All dates are local
 * calendar days (yyyy-mm-dd). The reminder time (default 08:30 local) is combined
 * with the chosen date into `reminder_at` by the parent via composeReminderAt.
 *
 * The name field auto-derives "{originLabel} · {Weekday Mon D}" and stays in sync
 * with the date until the rep edits it (an override latches — see the wizard).
 */
import { Calendar as CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, FormField, Input } from "@/components/navigatr";
import { todayISO, addDaysISO } from "../../lib/today";
import { nextMondayISO, weekdayLabel } from "../../lib/scheduleDate";

/** A date quick-pick option key. `custom` = the rep typed a date directly. */
export type DateQuickPick = "today" | "tomorrow" | "next_week" | "custom";

export interface PlanScheduleStepProps {
  /** Chosen calendar day (yyyy-mm-dd). */
  date: string;
  onDateChange: (iso: string, pick: DateQuickPick) => void;
  /** Which quick-pick is active (drives the highlighted button). */
  activePick: DateQuickPick;
  /** Reminder wall-clock time "HH:MM" (local). Empty string = no reminder. */
  reminderTime: string;
  onReminderTimeChange: (time: string) => void;
  /** Editable path name. */
  name: string;
  onNameChange: (name: string) => void;
  /** Whether the chosen date is valid (today or later) — drives the inline hint. */
  dateValid: boolean;
}

export function PlanScheduleStep({
  date,
  onDateChange,
  activePick,
  reminderTime,
  onReminderTimeChange,
  name,
  onNameChange,
  dateValid,
}: PlanScheduleStepProps) {
  const quickPicks: Array<{ key: DateQuickPick; label: string; iso: string }> = [
    { key: "today", label: "Today", iso: todayISO() },
    { key: "tomorrow", label: "Tomorrow", iso: addDaysISO(todayISO(), 1) },
    { key: "next_week", label: "Next week", iso: nextMondayISO() },
  ];

  return (
    <div className="flex flex-col gap-5 md:mx-auto md:w-full md:max-w-2xl">
      <div className="flex flex-col gap-1">
        <h2 className="text-heading-md text-text-default">Schedule your path</h2>
        <p className="text-body-md text-text-muted">
          Pick a day to run it and we&apos;ll remind you. It&apos;ll wait in Upcoming until you launch.
        </p>
      </div>

      <Card padding="lg" className="flex flex-col gap-5">
        {/* Date quick-picks */}
        <div className="flex flex-col gap-2">
          <span className="text-label text-text-default">When</span>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Path date">
            {quickPicks.map((qp) => (
              <button
                key={qp.key}
                type="button"
                onClick={() => onDateChange(qp.iso, qp.key)}
                aria-pressed={activePick === qp.key}
                className={cn(
                  "inline-flex flex-col items-start gap-0.5 rounded-radius-md border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
                  activePick === qp.key
                    ? "border-brand-primary bg-brand-primary/10 text-text-default"
                    : "border-border-default text-text-muted hover:border-border-strong hover:text-text-default",
                )}
              >
                <span className="text-body-strong">{qp.label}</span>
                <span className="text-caption tabular-nums text-text-muted">{weekdayLabel(qp.iso)}</span>
              </button>
            ))}
          </div>
          <div className="mt-1">
            <FormField
              label="Or pick a date"
              htmlFor="plan-schedule-date"
              error={dateValid ? undefined : "Choose today or a future date."}
            >
              <Input
                id="plan-schedule-date"
                type="date"
                leadingIcon={CalendarIcon}
                min={todayISO()}
                value={date}
                onChange={(e) => onDateChange(e.target.value, "custom")}
              />
            </FormField>
          </div>
        </div>

        {/* Reminder time */}
        <FormField
          label="Remind me at"
          htmlFor="plan-schedule-reminder"
          helper="We'll surface it in your notifications on the day."
        >
          <Input
            id="plan-schedule-reminder"
            type="time"
            value={reminderTime}
            onChange={(e) => onReminderTimeChange(e.target.value)}
          />
        </FormField>

        {/* Name */}
        <FormField label="Name this path" htmlFor="plan-schedule-name">
          <Input
            id="plan-schedule-name"
            type="text"
            value={name}
            placeholder="Name your path"
            onChange={(e) => onNameChange(e.target.value)}
          />
        </FormField>
      </Card>
    </div>
  );
}

export default PlanScheduleStep;
