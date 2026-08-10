import * as React from "react";
import { Loader2, Navigation, Pause } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/navigatr";
import { useTodayPath, type TodayStop } from "../hooks/useTodayPath";
import { routeStats } from "../lib/routeStats";
import { directionsUrl } from "../lib/directionsUrl";
import { merchantFromStop } from "../lib/merchantFromStop";
import { DropInSheet } from "./DropInSheet";
import { EndRouteSheet } from "./EndRouteSheet";
import { PathSummary } from "./PathSummary";
import { LogActivitySheet } from "@/features/activities/components/LogActivitySheet";
import { AppointmentOutcomeSheet } from "@/features/appointments/components/AppointmentOutcomeSheet";
import { usePathMutations } from "../hooks/usePathMutations";
import { useDrivingSequence } from "../hooks/useDrivingSequence";
import type { DrivingCard } from "../lib/drivingSequence";
import { todayISO } from "../lib/today";
import { type Disposition } from "@/lib/followUpScheduling";
import type { Merchant, MerchantCategory } from "../mockData";

export interface RunningPathProps {
  origin: { lat: number; lng: number };
  onPause: () => void;
  onViewPipeline: () => void;
  onExit: () => void;
  /** Open the "find near me" discovery surface (PathPage's enterDiscover). */
  onFindNearby: () => void;
}

type PathSummaryStats = {
  visitedCount: number;
  skippedCount: number;
  totalStops: number;
  routeMeters: number;
  dispositions: Disposition[];
  dealsCreated: number;
};

/**
 * Compute the six PathSummary stat fields from the current stop list. When
 * `countPendingAsSkipped` is true, pending stops are folded into `skippedCount`
 * (the route-complete snapshot rule); otherwise only status==="skipped" counts.
 */
function computePathSummaryStats(
  stops: TodayStop[],
  origin: { lat: number; lng: number },
  visited: number,
  total: number,
  { countPendingAsSkipped }: { countPendingAsSkipped: boolean },
): PathSummaryStats {
  const skipped = stops.filter((s) => s.status === "skipped").length;
  const pending = countPendingAsSkipped
    ? stops.filter((s) => s.status === "pending").length
    : 0;
  return {
    visitedCount: visited,
    skippedCount: skipped + pending,
    totalStops: total,
    routeMeters: routeStats(origin, stops.map((s) => ({ lat: s.lat, lng: s.lng }))).totalRouteMeters,
    dispositions: stops.map((s) => s.disposition).filter((d): d is Disposition => d != null),
    dealsCreated: stops.filter((s) => s.dealCreated).length,
  };
}

/** Build the Merchant shape DropInSheet needs for a "nearby" card. A nearby
 *  card is a native path_stop, so the persisted snapshot (with its category and
 *  phone) is the source of truth. Reuse merchantFromStop while we still hold it,
 *  falling back to the card's own fields if the stop has already left the list. */
function nearbyMerchant(card: DrivingCard, stops: TodayStop[]): Merchant {
  const stop = stops.find((s) => s.merchantId === card.merchantId);
  if (stop) return merchantFromStop(stop);
  return {
    id: card.merchantId ?? card.id,
    name: card.name,
    category: "other" as MerchantCategory,
    address: card.address ?? "",
    lat: card.lat ?? 0,
    lng: card.lng ?? 0,
    phone: "",
    employeeCountRange: "",
    status: "untouched",
    lastActivity: null,
    primaryType: null,
  };
}

/**
 * RunningPath (FR-PATH-UX-06/07/09). The in-field Driving screen: the WHOLE day
 * presented ONE stop at a time as a single-card carousel over
 * `useDrivingSequence` (appointments, owed drop-ins, due-today, and native
 * nearby, in the app's composed order). Each card shows the business, its
 * arrival and drive estimates, the reason it is on the route, and exactly three
 * actions (I'm here / Navigate / Skip for now) plus a "Who's near me right now"
 * escape hatch into discovery.
 *
 * "I'm here" opens the outcome flow appropriate to the card's kind (appointment
 * outcome, owed drop-in against the existing deal, or a create-deal drop-in for
 * a nearby prospect); an external calendar meeting has no navigatr outcome, so
 * its action reads "Mark done" and simply resolves the card.
 *
 * Advancement is deterministic and does NOT depend on refetch timing: a
 * successful log (or a skip / mark-done) adds the card id to a LOCAL `resolved`
 * set, so the card leaves `visibleCards` immediately and the clamp shows the
 * next stop. This is uniform across every kind, fixing the case where owed
 * cards linger and appointment cards never left the carousel. The top bar
 * (Pause / End route) and the End-route/Pause flow are unchanged.
 */
export function RunningPath({ origin, onPause, onViewPipeline, onExit, onFindNearby }: RunningPathProps) {
  const { stops, clear, pathId, pendingCount } = useTodayPath();
  const { carryToTomorrow, finalizeCurrentPath } = usePathMutations();
  const queryClient = useQueryClient();

  // A STABLE `now` captured once on mount (the arrival clock threads forward
  // from here) and a reference-stable origin so useDrivingSequence's memo does
  // not churn every render.
  const [nowIso] = React.useState(() => new Date().toISOString());
  const stableOrigin = React.useMemo(() => ({ lat: origin.lat, lng: origin.lng }), [origin.lat, origin.lng]);
  const { cards, isLoading } = useDrivingSequence(todayISO(), stableOrigin, nowIso);

  const [index, setIndex] = React.useState(0);
  const [endOpen, setEndOpen] = React.useState(false);
  const [completed, setCompleted] = React.useState<PathSummaryStats | null>(null);
  // Cards the rep has resolved this session (logged, skipped, or marked done).
  // Drives advancement locally so the carousel never waits on a refetch.
  const [resolved, setResolved] = React.useState<ReadonlySet<string>>(() => new Set());
  const resolve = React.useCallback((id: string) => {
    setResolved((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);
  // Open outcome-sheet state, keyed by card kind. Only one is ever open.
  const [apptSheet, setApptSheet] = React.useState<{ id: string; appointmentId: string; dealId: string; name: string } | null>(null);
  const [owedCard, setOwedCard] = React.useState<{ id: string; dealId: string } | null>(null);
  const [nearby, setNearby] = React.useState<{ id: string; merchant: Merchant } | null>(null);

  const visibleCards = React.useMemo(
    () => cards.filter((c) => !resolved.has(c.id)),
    [cards, resolved],
  );

  const total = stops.length;
  const visited = stops.filter((s) => s.status === "visited").length;

  // Keep the index in range as cards resolve out of the carousel or the
  // sequence first populates.
  React.useEffect(() => {
    if (index > visibleCards.length - 1) setIndex(Math.max(0, visibleCards.length - 1));
  }, [visibleCards.length, index]);

  const handleEndRoute = () => {
    if (pendingCount() === 0) { onExit(); return; }
    setEndOpen(true);
  };
  const handleCarry = async () => {
    if (!pathId) return;
    try {
      await carryToTomorrow.mutateAsync({ pathId, pathDate: todayISO() });
      setEndOpen(false);
      onExit();
    } catch {
      toast.error("Couldn't carry the stops to tomorrow. Please try again.");
    }
  };
  const handleComplete = async () => {
    if (!pathId) return;
    const snapshot = computePathSummaryStats(stops, origin, visited, total, { countPendingAsSkipped: true });
    try {
      await finalizeCurrentPath.mutateAsync(pathId);
      setEndOpen(false);
      setCompleted(snapshot);
    } catch {
      toast.error("Couldn't mark the route complete. Please try again.");
    }
  };
  const handleClearRestart = async () => {
    if (!window.confirm("Clear today's path and start over?")) return;
    try {
      await clear();
      setEndOpen(false);
      onExit();
    } catch {
      toast.error("Couldn't clear the path. Please try again.");
    }
  };

  // The route was explicitly finalized (End route then Mark complete): show the
  // report snapshot. Takes precedence over the live sequence.
  if (completed) {
    return (
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
        <PathSummary
          {...completed}
          onViewPipeline={onViewPipeline}
          onNewPath={() => { void clear(); onExit(); }}
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="mt-6 flex flex-col items-center justify-center gap-2">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-hidden />
        <p className="text-caption text-text-muted">Loading your day...</p>
      </div>
    );
  }

  // Nothing left on the whole day: the done report (all tiers resolved).
  if (visibleCards.length === 0) {
    const stats = computePathSummaryStats(stops, origin, visited, total, { countPendingAsSkipped: false });
    return (
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
        <PathSummary
          {...stats}
          onViewPipeline={onViewPipeline}
          onNewPath={() => { void clear(); onExit(); }}
        />
      </div>
    );
  }

  const clampedIndex = Math.min(index, visibleCards.length - 1);
  const card = visibleCards[clampedIndex]!;
  const hasCoords = card.lat != null && card.lng != null;
  const isExternal = card.kind === "external";

  const handleImHere = () => {
    switch (card.kind) {
      case "appointment":
        if (card.appointmentId && card.dealId) {
          setApptSheet({ id: card.id, appointmentId: card.appointmentId, dealId: card.dealId, name: card.name });
        } else {
          resolve(card.id);
        }
        break;
      case "owed":
        if (card.dealId) setOwedCard({ id: card.id, dealId: card.dealId });
        else resolve(card.id);
        break;
      case "nearby":
        setNearby({ id: card.id, merchant: nearbyMerchant(card, stops) });
        break;
      case "external":
        // No navigatr outcome to record: "Mark done" just resolves the card.
        resolve(card.id);
        break;
    }
  };

  const skip = () => {
    // TODO(Robert): wire task snooze (FR-PATH-DROP-08). A snooze mutation exists
    // (useTaskMutations.snoozeTask), but it needs the task's band dates
    // (earliest/target/latest/snoozeCount) which the DrivingCard does not carry,
    // so it is not reusable from here yet. Resolve locally (advance) only; the
    // underlying task is never deleted.
    resolve(card.id);
  };

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-center justify-between rounded-radius-md bg-surface-sunken px-4 py-2.5">
        <span className="text-body-md font-medium text-text-default">
          <span className="mr-2 inline-block h-2 w-2 rounded-radius-full bg-status-success align-middle" aria-hidden />
          Path active · {visited}/{total} stops
        </span>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" leadingIcon={Pause} onClick={onPause}>Pause</Button>
          <Button variant="tertiary" size="sm" onClick={handleEndRoute}>End route</Button>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-radius-md border border-border-default p-4">
        <span className="text-caption font-medium uppercase tracking-wide text-text-muted">
          Stop {clampedIndex + 1} of {visibleCards.length}
        </span>

        <div className="flex flex-col gap-1">
          <h2 className="text-heading-md text-text-default">{card.name}</h2>
          {card.address && <p className="truncate text-body-md text-text-muted">{card.address}</p>}
        </div>

        {/* Arrival and drive estimates, side by side. */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-0.5 rounded-radius-md bg-surface-sunken px-3 py-2">
            <span className="text-caption font-medium uppercase tracking-wide text-text-muted">Arrival</span>
            <span className="text-body-strong text-text-default">{card.arriveLabel}</span>
          </div>
          <div className="flex flex-col gap-0.5 rounded-radius-md bg-surface-sunken px-3 py-2">
            <span className="text-caption font-medium uppercase tracking-wide text-text-muted">Drive</span>
            <span className="text-body-strong text-text-default">{card.driveMinLabel}</span>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <p className="text-body-md text-text-default">{card.reason}</p>
          {card.lastVisit && <p className="text-caption text-text-muted">{card.lastVisit}</p>}
        </div>

        {/* Exactly three actions. */}
        <div className="flex flex-col gap-2">
          <Button variant="primary" className="w-full" onClick={handleImHere}>
            {isExternal ? "Mark done" : "I'm here"}
          </Button>
          <div className="flex gap-2">
            {hasCoords && (
              <a
                href={directionsUrl(card.lat as number, card.lng as number)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-radius-md border border-border-default px-3 py-2 text-body-md text-text-default hover:bg-surface-sunken"
              >
                <Navigation className="h-4 w-4" aria-hidden /> Navigate
              </a>
            )}
            <Button variant="secondary" className="flex-1" onClick={skip}>Skip for now</Button>
          </div>
        </div>

        <button
          type="button"
          onClick={onFindNearby}
          className="self-start text-body-md font-medium text-brand-primary hover:underline"
        >
          Who's near me right now
        </button>
      </div>

      <EndRouteSheet
        open={endOpen}
        onOpenChange={setEndOpen}
        pendingCount={pendingCount()}
        busy={carryToTomorrow.isPending || finalizeCurrentPath.isPending}
        onComplete={handleComplete}
        onCarry={handleCarry}
        onClear={handleClearRestart}
      />

      {/* Outcome sheets, reused verbatim from the Stops tab / pipeline. On a
          successful log we resolve the card locally so it leaves the carousel
          immediately; the sheets fire their own confirmation toasts. */}
      {apptSheet && (
        <AppointmentOutcomeSheet
          open
          onOpenChange={(o) => { if (!o) setApptSheet(null); }}
          appointmentId={apptSheet.appointmentId}
          dealId={apptSheet.dealId}
          merchantName={apptSheet.name}
          hasFutureAppointment={false}
          onRecorded={() => resolve(apptSheet.id)}
        />
      )}
      {owedCard && (
        <LogActivitySheet
          open
          onOpenChange={(o) => { if (!o) setOwedCard(null); }}
          dealId={owedCard.dealId}
          defaultType="drop_in"
          onLogged={() => {
            resolve(owedCard.id);
            // Belt and suspenders: also invalidate the owed / due-today reads so
            // the other surfaces (Stops tab) drop the resolved stop too.
            void queryClient.invalidateQueries({ queryKey: ["path", "owed-visits"] });
            void queryClient.invalidateQueries({ queryKey: ["path", "due-today-visits"] });
          }}
        />
      )}
      <DropInSheet
        merchant={nearby?.merchant ?? null}
        open={nearby != null}
        onOpenChange={(o) => { if (!o) setNearby(null); }}
        onLogged={() => { if (nearby) resolve(nearby.id); }}
      />
    </div>
  );
}
