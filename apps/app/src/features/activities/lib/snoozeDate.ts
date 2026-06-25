/** Snooze a follow-up task: push its date forward from `now` (UTC). Frontend-only. */
export type SnoozeOption = "tomorrow" | "3days" | "week";

export const SNOOZE_OPTIONS: { value: SnoozeOption; label: string; days: number }[] = [
  { value: "tomorrow", label: "Tomorrow", days: 1 },
  { value: "3days", label: "In 3 days", days: 3 },
  { value: "week", label: "Next week", days: 7 },
];

export function snoozeDate(option: SnoozeOption, now: Date): string {
  const days = SNOOZE_OPTIONS.find((o) => o.value === option)?.days ?? 1;
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
