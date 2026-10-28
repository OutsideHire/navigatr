/**
 * ReferralHistory: a collapsible "History" list for one referral, on Deal
 * Detail and in the review sheet (FR-PORT-60). Date, what happened, who did it.
 * Reps only: it shows internal statuses and reassignments the partner never sees.
 */
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { useReferralHistory, type ReferralHistoryEntry } from "../hooks/useReferralHistory";
import { REFERRAL_STATUS_LABEL } from "../lib/referrals";

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function describeHistoryEntry(entry: ReferralHistoryEntry): string {
  if (entry.fromStatus === entry.toStatus && entry.note) return entry.note;
  const status = REFERRAL_STATUS_LABEL[entry.toStatus];
  const base = entry.fromStatus ? `Moved to ${status}` : status;
  return entry.note ? `${base}. ${entry.note}` : base;
}

function whoLabel(entry: ReferralHistoryEntry): string {
  if (entry.actorType === "partner") return "Partner";
  if (entry.actorType === "system") return "System";
  return entry.actorName ?? "Your team";
}

export function ReferralHistory({ referralId }: { referralId: string }) {
  const { data, isError } = useReferralHistory(referralId);
  const [open, setOpen] = React.useState(false);
  const panelId = `referral-history-${referralId}`;

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 self-start text-eyebrow text-text-subtle hover:text-text-muted"
      >
        HISTORY
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div id={panelId}>
          {isError ? (
            <p className="text-caption text-text-subtle">Couldn't load the history.</p>
          ) : !data || data.length === 0 ? (
            <p className="text-caption text-text-subtle">No history yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.map((h) => (
                <li key={h.id} className="flex flex-col gap-0.5">
                  <p className="break-words text-body-md text-text-default">{describeHistoryEntry(h)}</p>
                  <span className="text-caption text-text-subtle">
                    {shortDate(h.createdAt)} · {whoLabel(h)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default ReferralHistory;
