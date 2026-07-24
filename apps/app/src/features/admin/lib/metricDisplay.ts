/**
 * Team roster metric display helpers. A "zero" metric (no pipeline, no deals,
 * no activity) is dimmed so the real numbers stand out. Negative is treated as
 * real data (dimming is only for the empty case).
 */
export function isZeroMetric(value: number): boolean {
  return value === 0;
}
