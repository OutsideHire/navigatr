/**
 * followUpSupersession — decides when a follow-up derived from a past
 * activity has been satisfied by a newer touch on the same deal.
 *
 * There is no task entity: a "follow-up" is just an activity's stored
 * followUpDate. So the only signal that a rep has handled a follow-up is
 * that they logged a *later* activity on that deal. The most recent
 * activity owns the deal's next follow-up; any earlier activity's
 * follow-up is considered done (superseded).
 *
 * This is what lets logging an outcome clear an overdue follow-up from
 * the Activities list and the bell badge: once the new activity is the
 * latest touch, the old follow-up drops out. It mirrors how
 * deals.next_followup_at already tracks only the most recent touch.
 *
 * Both the Activities page task list (deriveTasks) and the TopBar bell
 * (useFollowUpReminders) run through this helper so they never disagree.
 */

interface FollowUpActivityLike {
  dealId: string;
  /** ISO timestamp; compared lexicographically (all values are UTC ISO). */
  occurredAt: string;
}

/**
 * Map each deal to the occurredAt of its most recent activity. ISO strings
 * are compared lexicographically, which is correct for the uniform UTC ISO
 * format used across the app.
 */
export function latestOccurredAtByDeal(activities: FollowUpActivityLike[]): Map<string, string> {
  const latest = new Map<string, string>();
  for (const a of activities) {
    const prev = latest.get(a.dealId);
    if (prev === undefined || a.occurredAt.localeCompare(prev) > 0) {
      latest.set(a.dealId, a.occurredAt);
    }
  }
  return latest;
}

/**
 * True when a strictly later activity exists on the same deal, meaning this
 * activity's follow-up has been handled and should no longer be shown.
 *
 * The activity that IS the latest touch on its deal is never superseded
 * (its own follow-up is the live one). A deal absent from the map (no
 * activities) is never superseded.
 */
export function isFollowUpSuperseded(
  activity: FollowUpActivityLike,
  latestByDeal: Map<string, string>,
): boolean {
  const latest = latestByDeal.get(activity.dealId);
  if (latest === undefined) return false;
  return activity.occurredAt.localeCompare(latest) < 0;
}
