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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Card } from "@/components/navigatr";
import {
  useCalendarConnection,
  type CalendarProviderId,
} from "@/features/integrations/useCalendarConnection";
import { useProfile } from "@/features/auth/useProfile";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
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

const PRIMARY_OPTIONS: Array<{ provider: CalendarProviderId; label: string }> = [
  { provider: "google", label: "Google Calendar" },
  { provider: "microsoft", label: "Outlook Calendar" },
];

/**
 * PrimaryCalendarControl: lets a rep who has BOTH calendars connected choose
 * which one navigatr writes appointments/follow-ups to. Only meaningful with
 * two providers, so the caller renders it only then. Reads the current choice
 * from the profile and writes `primary_calendar_provider`, then invalidates the
 * profile query so useProfile (and the push resolver's next read) sees it.
 */
function PrimaryCalendarControl() {
  const userId = useAuth((s) => s.user?.id);
  const queryClient = useQueryClient();
  const { data: profile } = useProfile();
  const current = profile?.primary_calendar_provider ?? null;

  const setPrimary = useMutation({
    mutationFn: async (provider: CalendarProviderId): Promise<void> => {
      // Goes through the SECURITY DEFINER RPC, not a direct table UPDATE:
      // 20260812000001 revokes UPDATE on profiles from `authenticated` so that
      // newly added columns are unwritable by default (that default being
      // writable was the self-escalation hole). 20260812000003 reopens exactly
      // this one column, on the caller's own row.
      const { error } = await supabase.rpc("set_primary_calendar_provider", {
        p_provider: provider,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["profile", userId] });
    },
  });

  return (
    <Card padding="md">
      <h3 className="text-body-strong">Primary calendar</h3>
      <p className="mt-1 text-body-md text-text-muted">
        Both calendars are connected. Choose which one navigatr writes your
        appointments and follow-ups to.
      </p>
      <div className="mt-3 flex gap-2">
        {PRIMARY_OPTIONS.map(({ provider, label }) => (
          <Button
            key={provider}
            variant={current === provider ? "primary" : "secondary"}
            size="sm"
            aria-pressed={current === provider}
            disabled={setPrimary.isPending}
            onClick={() => setPrimary.mutate(provider)}
          >
            {label}
          </Button>
        ))}
      </div>
    </Card>
  );
}

export function IntegrationsTab() {
  // The primary-calendar picker only makes sense when both providers are
  // actively connected; hide it otherwise.
  const googleStatus = useCalendarConnection("google").status;
  const microsoftStatus = useCalendarConnection("microsoft").status;
  const bothConnected =
    googleStatus === "connected" && microsoftStatus === "connected";

  return (
    <>
      <TabHeader
        title="Integrations"
        subtitle="Connect the tools that power your Path."
      />
      <div className="flex flex-col gap-4">
        <CalendarProviderCard provider="google" label="Google Calendar" />
        <CalendarProviderCard provider="microsoft" label="Outlook Calendar" />
        {bothConnected && <PrimaryCalendarControl />}
      </div>
    </>
  );
}
