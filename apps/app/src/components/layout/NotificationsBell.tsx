/**
 * NotificationsBell — TopBar surface for due-today + overdue follow-ups.
 *
 * Sources its data from useFollowUpReminders (a derived view over the
 * existing activities + deals caches, no new network). Click → opens a
 * DropdownMenu with up to N reminders; each item navigates to the deal.
 *
 * Badge: red dot with a count when there's at least one reminder. The
 * count caps at "9+" so a rep with 40 stale follow-ups doesn't blow out
 * the badge width.
 */

import { Bell, Phone, Mail, MapPin, Calendar, Route as RouteIcon, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useFollowUpReminders,
  type FollowUpReminder,
} from "@/features/activities/hooks/useFollowUpReminders";
import {
  usePathReminders,
  type PathReminder,
} from "@/features/path/hooks/usePathReminders";
import {
  usePartnerFollowUpReminders,
  type PartnerFollowUpReminder,
} from "@/features/partners/hooks/usePartnerFollowUpReminders";
import { formatReminder } from "@/features/path/lib/scheduleDate";
import type { ActivityType } from "@/features/activities/mockData";

const TYPE_ICON: Record<ActivityType, typeof Phone> = {
  call: Phone,
  email: Mail,
  drop_in: MapPin,
  appointment: Calendar,
};

function ReminderRow({
  reminder,
  onNavigate,
}: {
  reminder: FollowUpReminder;
  onNavigate: (dealId: string) => void;
}) {
  const Icon = TYPE_ICON[reminder.activity.type];
  const overdue = reminder.daysOverdue > 0;
  const label = overdue
    ? `${reminder.daysOverdue}d overdue`
    : "Due today";

  return (
    <DropdownMenuItem
      onSelect={() => onNavigate(reminder.deal.id)}
      className="flex items-start gap-2"
    >
      <span
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-radius-full",
          overdue
            ? "bg-status-danger-bg text-status-danger"
            : "bg-status-warning-bg text-status-warning",
        )}
        aria-hidden
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-body-strong text-text-default">
          {reminder.deal.companyName}
        </span>
        <span className="truncate text-caption text-text-muted">
          {reminder.deal.contactName}
        </span>
      </div>
      <span
        className={cn(
          "shrink-0 self-center text-caption tabular-nums",
          overdue ? "text-status-danger" : "text-status-warning",
        )}
      >
        {label}
      </span>
    </DropdownMenuItem>
  );
}

function PathReminderRow({
  reminder,
  onNavigate,
}: {
  reminder: PathReminder;
  onNavigate: () => void;
}) {
  const when = formatReminder(reminder.reminderAt) ?? "Today";
  return (
    <DropdownMenuItem onSelect={onNavigate} className="flex items-start gap-2">
      <span
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-radius-full bg-brand-primary/15 text-brand-primary"
        aria-hidden
      >
        <RouteIcon className="h-3.5 w-3.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-body-strong text-text-default">{reminder.name}</span>
        <span className="truncate text-caption text-text-muted">Planned path</span>
      </div>
      <span className="shrink-0 self-center text-caption tabular-nums text-brand-primary">
        {when}
      </span>
    </DropdownMenuItem>
  );
}

function PartnerReminderRow({
  reminder,
  onNavigate,
}: {
  reminder: PartnerFollowUpReminder;
  onNavigate: (partnerId: string) => void;
}) {
  const overdue = reminder.daysOverdue > 0;
  const label = overdue ? `${reminder.daysOverdue}d overdue` : "Due today";
  return (
    <DropdownMenuItem onSelect={() => onNavigate(reminder.id)} className="flex items-start gap-2">
      <span
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-radius-full",
          overdue ? "bg-status-danger-bg text-status-danger" : "bg-status-warning-bg text-status-warning",
        )}
        aria-hidden
      >
        <Users className="h-3.5 w-3.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-body-strong text-text-default">{reminder.partner.name}</span>
        <span className="truncate text-caption text-text-muted">{reminder.partner.company}</span>
      </div>
      <span
        className={cn(
          "shrink-0 self-center text-caption tabular-nums",
          overdue ? "text-status-danger" : "text-status-warning",
        )}
      >
        {label}
      </span>
    </DropdownMenuItem>
  );
}

export interface NotificationsBellProps {
  /** Max reminders rendered before showing "+N more". Defaults to 6. */
  maxItems?: number;
  /** Override "now" for tests / time-travel demos. */
  now?: Date;
}

export function NotificationsBell({ maxItems = 6, now }: NotificationsBellProps) {
  const navigate = useNavigate();
  const { overdue, today, count: followUpCount } = useFollowUpReminders(now);
  const { due: duePaths, count: pathCount } = usePathReminders(now);
  const {
    overdue: partnerOverdue,
    today: partnerToday,
    count: partnerCount,
  } = usePartnerFollowUpReminders(now);

  const all = [...overdue, ...today];
  const shown = all.slice(0, maxItems);
  const hidden = all.length - shown.length;

  const partnerReminders = [...partnerOverdue, ...partnerToday];

  // Total badge = follow-ups + due planned paths + partner cadence reminders.
  const count = followUpCount + pathCount + partnerCount;

  const handleNavigate = (dealId: string) => navigate(`/pipeline/${dealId}`);
  const handleNavigatePath = () => navigate("/path");
  const handleNavigatePartner = (partnerId: string) => navigate(`/partners/${partnerId}`);

  // 9+ cap keeps the badge a tight circle.
  const badgeText = count > 9 ? "9+" : String(count);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={count > 0 ? `Notifications: ${count}` : "Notifications"}
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-radius-sm text-text-default hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-default"
        >
          <Bell className="h-5 w-5" />
          {count > 0 && (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-radius-full bg-status-danger px-1 text-[10px] font-semibold leading-none text-white"
            >
              {badgeText}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-1rem)]">
        <DropdownMenuLabel className="flex items-center justify-between normal-case tracking-normal">
          <span className="text-body-strong text-text-default">Notifications</span>
          {count > 0 && (
            <span className="text-caption text-text-muted">
              {[
                followUpCount > 0 && `${followUpCount} follow-up${followUpCount === 1 ? "" : "s"}`,
                partnerCount > 0 && `${partnerCount} partner${partnerCount === 1 ? "" : "s"}`,
                pathCount > 0 && `${pathCount} path${pathCount === 1 ? "" : "s"}`,
              ].filter(Boolean).join(" · ")}
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {count === 0 ? (
          <div className="px-2 py-6 text-center">
            <p className="text-body-md text-text-muted">You&apos;re all caught up.</p>
            <p className="mt-1 text-caption text-text-subtle">
              Follow-ups and scheduled paths appear here.
            </p>
          </div>
        ) : (
          <>
            {/* Due planned paths (SP3) — additive section above follow-ups. */}
            {duePaths.length > 0 && (
              <>
                {duePaths.map((p) => (
                  <PathReminderRow key={p.id} reminder={p} onNavigate={handleNavigatePath} />
                ))}
                {followUpCount > 0 && <DropdownMenuSeparator />}
              </>
            )}

            {partnerReminders.length > 0 && (
              <>
                {partnerReminders.map((r) => (
                  <PartnerReminderRow key={r.id} reminder={r} onNavigate={handleNavigatePartner} />
                ))}
                {followUpCount > 0 && <DropdownMenuSeparator />}
              </>
            )}

            {shown.map((r) => (
              <ReminderRow key={r.id} reminder={r} onNavigate={handleNavigate} />
            ))}
            {hidden > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate("/activities")}>
                  <span className="text-caption text-text-muted">
                    +{hidden} more — view all
                  </span>
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate("/activities")}>
              <span className="text-body-md text-text-default">Open Today queue</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default NotificationsBell;
