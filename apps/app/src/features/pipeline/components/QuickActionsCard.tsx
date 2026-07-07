/**
 * QuickActionsCard — Deal Detail right-rail actions (Figma 328:4).
 *
 * Slice 3a renders the shell: Send to CRM / Send as referral / Schedule
 * appointment are disabled "Coming soon" (no integrations yet); Mark as lost is
 * wired in slice 3b (FR-PIPE-07) when stage changes are centralized — until a
 * handler is passed it stays disabled. Later slices flip individual actions live
 * by passing handlers.
 */
import { Card } from "@/components/navigatr";
import { cn } from "@/lib/utils";

interface QuickAction {
  label: string;
  onClick?: () => void;
  danger?: boolean;
  /** Tooltip shown while the action is disabled. Omit when disabled is
   *  merely an un-wired handler (no explanatory tooltip wanted). */
  disabledTitle?: string;
}

function ActionButton({ action }: { action: QuickAction }) {
  const disabled = !action.onClick;
  return (
    <button
      type="button"
      disabled={disabled}
      aria-disabled={disabled}
      title={disabled ? action.disabledTitle : undefined}
      onClick={action.onClick}
      className={cn(
        "w-full rounded-radius-md border border-border-default px-3 py-2 text-body-sm font-medium",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
        disabled
          ? "cursor-not-allowed text-text-subtle"
          : action.danger
            ? "text-status-danger hover:bg-status-danger-bg"
            : "text-text-default hover:bg-surface-sunken",
      )}
    >
      {action.label}
    </button>
  );
}

export function QuickActionsCard({
  onSendReferral,
  onScheduleAppointment,
  onMarkLost,
}: {
  onSendReferral?: () => void;
  onScheduleAppointment?: () => void;
  onMarkLost?: () => void;
}) {
  const actions: QuickAction[] = [
    { label: "Send to CRM", disabledTitle: "Coming soon" },
    { label: "Send as referral", onClick: onSendReferral, disabledTitle: "Coming soon" },
    { label: "Schedule appointment", onClick: onScheduleAppointment },
    { label: "Mark as lost", onClick: onMarkLost, danger: true },
  ];
  return (
    <Card padding="md" shadow="sm" className="flex flex-col gap-3">
      <h2 className="text-body-strong text-text-default">Quick actions</h2>
      <div className="flex flex-col gap-2">
        {actions.map((a) => <ActionButton key={a.label} action={a} />)}
      </div>
    </Card>
  );
}

export default QuickActionsCard;
