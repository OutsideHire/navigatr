/**
 * ReferralUpdatesPanel: under "Referred by" on Deal Detail (spec 5.7). Lists
 * what was shared with the partner, newest first, and opens ShareUpdateSheet.
 * Short and scannable: reps read it in the field.
 */
import * as React from "react";
import { Button } from "@/components/navigatr";
import { useReferralUpdates } from "../hooks/useReferralUpdates";
import { ShareUpdateSheet } from "./ShareUpdateSheet";

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ReferralUpdatesPanel({ referralId, partnerLabel }: { referralId: string; partnerLabel: string }) {
  const { data: updates, isError } = useReferralUpdates(referralId);
  const [open, setOpen] = React.useState(false);

  return (
    <div className="mt-3 flex flex-col gap-2">
      {updates && updates.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-eyebrow text-text-subtle">SHARED WITH PARTNER</span>
          <ul className="flex flex-col gap-2">
            {updates.map((u) => (
              <li key={u.id} className="flex flex-col gap-0.5">
                <p className="whitespace-pre-wrap break-words text-body-md text-text-default">{u.body}</p>
                <span className="text-caption text-text-subtle">
                  {u.authorName ?? "Your team"} · {shortDate(u.publishedAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {isError && <p className="text-caption text-text-subtle">Couldn't load shared updates.</p>}
      <Button variant="secondary" className="self-start" onClick={() => setOpen(true)}>
        Share update with partner
      </Button>
      <ShareUpdateSheet open={open} onOpenChange={setOpen} referralId={referralId} partnerLabel={partnerLabel} />
    </div>
  );
}

export default ReferralUpdatesPanel;
