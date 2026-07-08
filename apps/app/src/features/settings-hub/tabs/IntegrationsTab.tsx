/**
 * IntegrationsTab — connect the rep's calendars (Google + Outlook) to navigatr.
 *
 * Slice 1: connect / disconnect / status only. Each rep connects their own
 * calendars (all roles see this tab). Once connected, a future slice adds the
 * per-calendar "personal" toggle here — that needs the calendar list from the
 * OAuth Edge function, which doesn't exist yet.
 *
 * One card per provider, each driven by its own useCalendarConnection(provider)
 * with three states from `.status`:
 *   - disconnected → explainer + "Connect <Provider> Calendar"
 *   - pending      → "Finishing connection…" note
 *   - connected    → connected row + "Disconnect"
 */
import { CalendarCheck } from "lucide-react";
import { Button, Card } from "@/components/navigatr";
import {
  useCalendarConnection,
  type CalendarProviderId,
} from "@/features/integrations/useCalendarConnection";
import { TabHeader } from "./TabHeader";

interface CalendarProviderCardProps {
  provider: CalendarProviderId;
  /** Human-facing calendar name, e.g. "Google Calendar" / "Outlook Calendar". */
  label: string;
}

/** A single provider's connect/disconnect/status card. */
function CalendarProviderCard({ provider, label }: CalendarProviderCardProps) {
  const { status, isLoading, connect, disconnect, isDisconnecting } =
    useCalendarConnection(provider);

  return (
    <Card padding="md">
      <h3 className="text-body-strong">{label}</h3>

      {isLoading ? (
        <p className="mt-1 text-body-md text-text-muted">Loading…</p>
      ) : status === "connected" ? (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CalendarCheck className="h-5 w-5 text-brand-primary" aria-hidden />
              <span className="text-body-md text-text-default">{label} connected</span>
            </div>
            <Button
              variant="secondary"
              size="md"
              loading={isDisconnecting}
              disabled={isDisconnecting}
              onClick={() => disconnect()}
            >
              Disconnect
            </Button>
          </div>
          {/* TODO(calendar-oauth-task): per-calendar personal toggle once the
              calendar list endpoint exists. Lists the rep's calendars with a
              per-calendar "treat as personal" switch so the Path builds around
              personal commitments too. */}
        </div>
      ) : status === "pending" ? (
        <p className="mt-1 text-body-md text-text-muted">Finishing connection…</p>
      ) : (
        <div className="mt-1 flex flex-col gap-3">
          <p className="text-body-md text-text-muted">
            Connect {label} so your Path builds around your meetings.
          </p>
          <div>
            <Button variant="primary" size="md" onClick={() => connect()}>
              Connect {label}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export function IntegrationsTab() {
  return (
    <>
      <TabHeader
        title="Integrations"
        subtitle="Connect the tools that power your Path."
      />
      <div className="flex flex-col gap-4">
        <CalendarProviderCard provider="google" label="Google Calendar" />
        <CalendarProviderCard provider="microsoft" label="Outlook Calendar" />
      </div>
    </>
  );
}
