/** Local-date helpers for paths. Leaf module (no hook imports) so both
 *  useTodayPath and usePreviousUnfinishedPath can share todayISO without a cycle. */

/** Today's local date as yyyy-mm-dd (path_date is a calendar day, local to the rep). */
export function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Human label for a path_date relative to today: "yesterday" or "Fri, Jun 5".
 *  Dates are parsed at local midnight (append T00:00:00) to avoid UTC shifting. */
export function formatPathDate(iso: string, todayIso: string = todayISO()): string {
  const d = new Date(`${iso}T00:00:00`);
  const today = new Date(`${todayIso}T00:00:00`);
  const diffDays = Math.round((today.getTime() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
