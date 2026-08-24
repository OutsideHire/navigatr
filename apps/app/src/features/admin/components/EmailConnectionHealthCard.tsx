/**
 * EmailConnectionHealthCard — operational readout of reps' Outlook email-capture
 * connections on the admin roster (Email Capture Phase 1, Slice 5d). Email
 * capture ships with no rep-facing status surface, so this is how an operator
 * sees during beta that polling is working, and which connections need a
 * reconnect. Admin-only: the RPC returns nothing to non-admins, so a rep sees
 * the empty state and the card renders harmlessly anywhere admin-scoped.
 *
 * The whole feature is dark until VITE_EMAIL_CAPTURE is set, so the caller
 * gates this behind EMAIL_CAPTURE_UI_ENABLED.
 */

import { Card } from "@/components/navigatr";
import { useEmailConnectionHealth } from "../hooks/useEmailConnectionHealth";
import { summarizeEmailConnectionHealth } from "../lib/emailConnectionHealth";

export function EmailConnectionHealthCard() {
  const { data = [], isLoading } = useEmailConnectionHealth();
  const summary = summarizeEmailConnectionHealth(data);

  return (
    <Card padding="md">
      <div className="flex flex-col gap-1">
        <h3 className="text-body-strong text-text-default">Email capture connections</h3>
        <p className="text-caption text-text-muted">
          Reps who connected Outlook for email logging, and whether polling is healthy.
        </p>
      </div>

      {isLoading ? (
        <p className="mt-4 text-body-sm text-text-muted">Loading…</p>
      ) : summary.total === 0 ? (
        <p className="mt-4 text-body-sm text-text-muted">
          No reps have connected Outlook for email logging yet.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex items-baseline gap-2">
            <span className="text-heading-lg tabular-nums text-text-default">
              {summary.healthy}/{summary.total}
            </span>
            <span className="text-caption text-text-muted">
              healthy
              {summary.attention > 0 ? ` · ${summary.attention} need attention` : ""}
            </span>
          </div>
          <ul className="flex flex-col gap-1">
            {summary.rows.map((r) => (
              <li
                key={r.user_id}
                className="flex items-center justify-between gap-3 text-caption"
              >
                <span className="min-w-0 truncate text-text-default">
                  {r.rep_name ?? "Unknown rep"}
                </span>
                <span
                  className={
                    "shrink-0 " + (r.healthy ? "text-text-muted" : "text-status-danger")
                  }
                >
                  {r.statusLabel}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
