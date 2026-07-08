import * as React from "react";
import { Pause, Phone, Navigation, ChevronLeft, ChevronRight, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/navigatr";
import { labelForCategory } from "../mockData";
import { useTodayPath, type TodayStop } from "../hooks/useTodayPath";
import { routeStats } from "../lib/routeStats";
import { directionsUrl } from "../lib/directionsUrl";
import { merchantFromStop } from "../lib/merchantFromStop";
import { DropInSheet } from "./DropInSheet";
import { EndRouteSheet } from "./EndRouteSheet";
import { PathSummary } from "./PathSummary";
import { RunScheduleOverlay } from "./RunScheduleOverlay";
import { usePathMutations } from "../hooks/usePathMutations";
import { todayISO } from "../lib/today";
import { DISPOSITIONS, type Disposition } from "@/lib/followUpScheduling";
import { firstPendingIndex } from "../lib/pathTypes";

export interface RunningPathProps {
  origin: { lat: number; lng: number };
  onPause: () => void;
  onViewPipeline: () => void;
  onExit: () => void;
  /**
   * Calendar-aware run overlay for the current stop (route-around optimizer,
   * Slice 2). Computed live by the parent from the rep's calendar + position;
   * null/undefined when there's nothing to show (calendar not connected, no
   * meetings today, or route complete) — in which case nothing new renders and
   * the running card looks exactly as it did before.
   */
  runOverlay?: {
    arrive: string | null;
    dwellMin: number;
    currentStopName: string;
    nextMeeting: { title: string; start: string; located: boolean } | null;
    stopsUntilNextMeeting: number;
    fits: boolean;
  } | null;
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

/**
 * RunningPath — Path v3 running mode. One focused stop at a time: Call / Directions /
 * Log drop-in, with Prev/Skip/Next. Logging a drop-in (via DropInSheet) auto-advances
 * to the next pending stop + an Undo toast. When no stops are pending, shows PathSummary.
 */
export function RunningPath({ origin, onPause, onViewPipeline, onExit, runOverlay }: RunningPathProps) {
  const { stops, setStatus, clear, pathId, pendingCount } = useTodayPath();
  const { carryToTomorrow, finalizeCurrentPath } = usePathMutations();
  // stops arrive position-ordered (useActivePath sorts, useTodayPath preserves it),
  // so array index == position order. Seek to the first pending stop; -1 (all done)
  // falls back to 0 — that case renders the summary anyway, index is unused.
  const fpi = firstPendingIndex(stops.map((s, i) => ({ position: i, status: s.status })));
  const [index, setIndex] = React.useState(Math.max(0, fpi));
  const [logOpen, setLogOpen] = React.useState(false);
  const [endOpen, setEndOpen] = React.useState(false);
  const [completed, setCompleted] = React.useState<PathSummaryStats | null>(null);

  const total = stops.length;
  const visited = stops.filter((s) => s.status === "visited").length;
  const allDone = total > 0 && stops.every((s) => s.status !== "pending");

  React.useEffect(() => {
    if (index > total - 1) setIndex(Math.max(0, total - 1));
  }, [total, index]);

  // When the stop list first populates (mount-before-load), jump to the first
  // pending stop. Fires only on the 0 → N transition so it never fights manual
  // Prev/Next or advance().
  const prevTotalRef = React.useRef(0);
  React.useEffect(() => {
    if (prevTotalRef.current === 0 && total > 0) {
      const fp = stops.findIndex((s) => s.status === "pending");
      if (fp > 0) setIndex(fp);
    }
    prevTotalRef.current = total;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

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

  if (allDone) {
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

  const cur = stops[index];
  if (!cur) return null;

  const advance = () => {
    const after = stops.findIndex((s, i) => i > index && s.status === "pending");
    if (after !== -1) { setIndex(after); return; }
    const anyPending = stops.findIndex((s) => s.status === "pending");
    if (anyPending !== -1) setIndex(anyPending);
  };
  const handleLogged = (d: Disposition) => {
    toast(`Logged: ${DISPOSITIONS[d].label}`, {
      action: { label: "Undo", onClick: () => { void setStatus(cur.merchantId, "pending"); } },
    });
    advance();
  };
  const skip = () => { void setStatus(cur.merchantId, "skipped"); advance(); };
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
      toast.error("Couldn't carry the stops to tomorrow — please try again.");
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
      toast.error("Couldn't mark the route complete — please try again.");
    }
  };
  const handleClearRestart = async () => {
    if (!window.confirm("Clear today's path and start over?")) return;
    try {
      await clear();
      setEndOpen(false);
      onExit();
    } catch {
      toast.error("Couldn't clear the path — please try again.");
    }
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

      <div className="flex flex-col gap-3 rounded-radius-md border border-border-default p-4">
        <span className="text-caption font-medium uppercase tracking-wide text-text-muted">Stop {index + 1} of {total}</span>
        <div className="flex flex-col gap-1">
          <h2 className="text-heading-sm text-text-default">{cur.name}</h2>
          <p className="text-body-md text-text-muted">
            {cur.address ? `${cur.address} · ` : ""}{labelForCategory(cur.category)}
          </p>
        </div>
        {runOverlay && <RunScheduleOverlay {...runOverlay} />}
        <div className="flex flex-wrap gap-2">
          {cur.phone && (
            <a href={`tel:${cur.phone}`}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-radius-md border border-border-default px-3 py-2 text-body-md text-text-default hover:bg-surface-sunken">
              <Phone className="h-4 w-4" aria-hidden /> Call
            </a>
          )}
          <a href={directionsUrl(cur.lat, cur.lng)} target="_blank" rel="noreferrer"
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-radius-md border border-border-default px-3 py-2 text-body-md text-text-default hover:bg-surface-sunken">
            <Navigation className="h-4 w-4" aria-hidden /> Directions
          </a>
        </div>
        {cur.status !== "pending" && cur.disposition && (
          <span className="text-caption text-text-muted">✓ Logged: {DISPOSITIONS[cur.disposition as Disposition]?.label ?? cur.disposition}</span>
        )}
        <Button variant="primary" leadingIcon={ClipboardList} className="w-full" onClick={() => setLogOpen(true)}>Log drop-in</Button>
      </div>

      <div className="flex items-center justify-between">
        <Button variant="tertiary" size="sm" leadingIcon={ChevronLeft} disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}>Prev</Button>
        <Button variant="tertiary" size="sm" onClick={skip}>Skip</Button>
        <Button variant="tertiary" size="sm" trailingIcon={ChevronRight} disabled={index >= total - 1}
          onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}>Next</Button>
      </div>

      <DropInSheet merchant={merchantFromStop(cur)} open={logOpen} onOpenChange={setLogOpen} onLogged={handleLogged} />
      <EndRouteSheet
        open={endOpen}
        onOpenChange={setEndOpen}
        pendingCount={pendingCount()}
        busy={carryToTomorrow.isPending || finalizeCurrentPath.isPending}
        onComplete={handleComplete}
        onCarry={handleCarry}
        onClear={handleClearRestart}
      />
    </div>
  );
}
