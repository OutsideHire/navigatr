/**
 * IntegrationsTab — connect the rep's Google Calendar to navigatr.
 *
 * Slice 1: connect / disconnect / status only. Each rep connects their own
 * calendar (all roles see this tab). Once connected, a future slice adds the
 * per-calendar "personal" toggle here — that needs the calendar list from the
 * OAuth Edge function, which doesn't exist yet.
 *
 * Three states driven by useCalendarConnection().status:
 *   - disconnected → explainer + "Connect Google Calendar"
 *   - pending      → "Finishing connection…" note
 *   - connected    → connected row + "Disconnect"
 */
import { CalendarCheck } from "lucide-react";
import { Button, Card } from "@/components/navigatr";
import { useCalendarConnection } from "@/features/integrations/useCalendarConnection";
import { TabHeader } from "./TabHeader";

export function IntegrationsTab() {
  const { status, isLoading, connect, disconnect, isDisconnecting } =
    useCalendarConnection();

  return (
    <>
      <TabHeader
        title="Integrations"
        subtitle="Connect the tools that power your Path."
      />
      <div className="flex flex-col gap-4">
        <Card padding="md">
          <h3 className="text-body-strong">Connected calendars</h3>

          {isLoading ? (
            <p className="mt-1 text-body-md text-text-muted">Loading…</p>
          ) : status === "connected" ? (
            <div className="mt-3 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <CalendarCheck className="h-5 w-5 text-brand-primary" aria-hidden />
                  <span className="text-body-md text-text-default">
                    Google Calendar connected
                  </span>
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
              {/* TODO(calendar-oauth-task): per-calendar personal toggle once
                  calendar list endpoint exists. Lists the rep's Google
                  calendars with a per-calendar "treat as personal" switch so
                  the Path builds around personal commitments too. */}
            </div>
          ) : status === "pending" ? (
            <p className="mt-1 text-body-md text-text-muted">
              Finishing connection…
            </p>
          ) : (
            <div className="mt-1 flex flex-col gap-3">
              <p className="text-body-md text-text-muted">
                Connect Google Calendar so your Path builds around your meetings.
              </p>
              <div>
                <Button variant="primary" size="md" onClick={() => connect()}>
                  Connect Google Calendar
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
