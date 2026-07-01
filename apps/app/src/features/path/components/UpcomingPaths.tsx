/**
 * UpcomingPaths — the rep's planned, future-dated paths (SP3).
 *
 * Lists paths with `path_date >= today` and `status = 'planned'` from usePaths,
 * each showing name, date, reminder time, and stop count, plus a Launch/Open
 * action. Paths due today are highlighted. Rendered on PathPage's entry state.
 *
 * Presentational: it reads usePaths itself (a cached query, no new network) but
 * delegates the launch navigation to the parent via onLaunch.
 */
import * as React from "react";
import { CalendarClock, ChevronRight, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, Card } from "@/components/navigatr";
import { usePaths } from "../hooks/usePaths";
import { todayISO, formatPathDate } from "../lib/today";
import { formatReminder } from "../lib/scheduleDate";
import type { Path } from "../lib/pathTypes";

export interface UpcomingPathsProps {
  /** Launch/open a planned path. */
  onLaunch: (path: Path) => void;
  /** Override "today" for tests. */
  todayIso?: string;
}

export function UpcomingPaths({ onLaunch, todayIso = todayISO() }: UpcomingPathsProps) {
  const { data: paths = [] } = usePaths();

  const upcoming = React.useMemo(
    () =>
      paths
        .filter((p) => p.status === "planned" && p.date >= todayIso)
        // Soonest day first.
        .sort((a, b) => a.date.localeCompare(b.date)),
    [paths, todayIso],
  );

  if (upcoming.length === 0) return null;

  return (
    <section className="mt-4 flex flex-col gap-2" aria-label="Upcoming paths">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-text-muted" aria-hidden />
        <h2 className="text-heading-sm text-text-default">Upcoming paths</h2>
      </div>

      <Card padding="none" className="overflow-hidden">
        <ul className="flex flex-col">
          {upcoming.map((p) => {
            const dueToday = p.date === todayIso;
            const reminder = formatReminder(p.reminderAt);
            const name = p.name ?? p.originLabel ?? "Planned path";
            return (
              <li
                key={p.id}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-border-subtle",
                  dueToday && "bg-brand-primary/5",
                )}
              >
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-radius-full",
                    dueToday
                      ? "bg-brand-primary/15 text-brand-primary"
                      : "bg-surface-sunken text-text-muted",
                  )}
                  aria-hidden
                >
                  <MapPin className="h-4 w-4" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body-strong text-text-default">{name}</span>
                  <span className="truncate text-caption text-text-muted">
                    {dueToday ? "Today" : formatPathDate(p.date, todayIso)}
                    {reminder ? ` · ${reminder}` : ""}
                    {` · ${p.stopCount} ${p.stopCount === 1 ? "stop" : "stops"}`}
                  </span>
                </div>
                <Button
                  variant={dueToday ? "primary" : "secondary"}
                  size="sm"
                  trailingIcon={ChevronRight}
                  onClick={() => onLaunch(p)}
                >
                  {dueToday ? "Launch" : "Open"}
                </Button>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}

export default UpcomingPaths;
