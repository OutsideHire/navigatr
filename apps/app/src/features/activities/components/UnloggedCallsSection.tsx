/**
 * UnloggedCallsSection — SP0 nudge on the Activities page. Lists the rep's
 * click-to-call dials that were never logged (one row per deal) with a
 * one-tap action to log the outcome via the existing LogActivitySheet,
 * prefilled to the Call form. Data-quality framing, not compliance
 * (PRD §3.3.C.11). Renders nothing when there is nothing to nudge.
 */

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Phone } from "lucide-react";
import { Button, Card } from "@/components/navigatr";
import { useAuth } from "@/stores/auth";
import { useUnloggedDials, UNLOGGED_DIALS_QUERY_KEY } from "../hooks/useUnloggedDials";
import { LogActivitySheet } from "./LogActivitySheet";

/**
 * Short relative time, e.g. "3h ago" / "2d ago" / "just now". Floors at each
 * unit boundary (89m → "1h ago"), i.e. "at least this long ago" — fine for a
 * nudge where exactness doesn't matter. Exported for direct branch testing.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function UnloggedCallsSection() {
  const { data: dials = [] } = useUnloggedDials();
  const [logDealId, setLogDealId] = React.useState<string | null>(null);
  const userId = useAuth((s) => s.user?.id);
  const queryClient = useQueryClient();

  if (dials.length === 0) return null;

  return (
    <Card className="mb-4 flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <Phone className="h-4 w-4 text-accent-teal" aria-hidden />
        <h2 className="text-heading-sm text-text-default">Unlogged calls ({dials.length})</h2>
      </div>
      <p className="text-body-sm text-text-muted">
        You started these calls but haven&apos;t logged an outcome yet.
      </p>
      <ul className="flex flex-col gap-2">
        {dials.map((d) => (
          <li
            key={d.dealId}
            className="flex items-center justify-between gap-3 rounded-radius-sm bg-surface-sunken px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-label text-text-default">{d.companyName}</p>
              <p className="text-body-sm text-text-muted">
                Call started {relativeTime(d.lastDetectedAt)} · not logged
                {d.dialCount > 1 ? ` (${d.dialCount} calls)` : ""}
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setLogDealId(d.dealId)}>
              Log outcome
            </Button>
          </li>
        ))}
      </ul>

      {logDealId && (
        <LogActivitySheet
          open
          onOpenChange={(o) => { if (!o) setLogDealId(null); }}
          dealId={logDealId}
          defaultType="call"
          onLogged={() => {
            setLogDealId(null);
            void queryClient.invalidateQueries({ queryKey: UNLOGGED_DIALS_QUERY_KEY(userId) });
          }}
        />
      )}
    </Card>
  );
}
