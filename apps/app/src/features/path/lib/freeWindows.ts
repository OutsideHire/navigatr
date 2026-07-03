// Pure: the day window minus occupied spans (calendar waypoints + time-blocks) →
// the ordered list of free intervals. Times are ISO strings compared via
// Date.parse. Overlapping/adjacent occupied spans are merged first so a
// back-to-back pair doesn't emit a zero-length gap between them.

export interface Interval {
  start: string; // ISO datetime
  end: string;   // ISO datetime
}

export function computeFreeWindows(
  windowStart: string,
  windowEnd: string,
  occupied: Interval[],
): Interval[] {
  const wStart = Date.parse(windowStart);
  const wEnd = Date.parse(windowEnd);
  if (!(wEnd > wStart)) return [];

  const clamped = occupied
    .map((s) => ({ start: Math.max(Date.parse(s.start), wStart), end: Math.min(Date.parse(s.end), wEnd) }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const s of clamped) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }

  const out: Interval[] = [];
  let cursor = wStart;
  for (const s of merged) {
    if (s.start > cursor) out.push({ start: new Date(cursor).toISOString(), end: new Date(s.start).toISOString() });
    cursor = Math.max(cursor, s.end);
  }
  if (cursor < wEnd) out.push({ start: new Date(cursor).toISOString(), end: new Date(wEnd).toISOString() });
  return out;
}
