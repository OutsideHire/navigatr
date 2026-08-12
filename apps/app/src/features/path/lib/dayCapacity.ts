/**
 * Plain-language day-capacity sentences (FR-PATH-UX-10).
 *
 * Pure helpers that turn the assembler's remaining-capacity number into the two
 * readings the "Your day" screen shows at the end of the list: how much time is
 * still open, or (when nothing more fits) a calm full-day statement in place of
 * a disabled control.
 */

/**
 * Round to the nearest QUARTER HOUR (15 min). The readout is a reference, not a
 * promise (v2.2 B 4.3.1): "About 50 minutes" is right, "47 minutes" is false
 * precision. 50 -> 45, 52 -> 45, 53 -> 60. Never negative.
 */
function roundToQuarterHour(min: number): number {
  return Math.max(0, Math.round(min / 15) * 15);
}

/** "about 45 minutes still open" - hedged + quarter-hour rounded (v2.2 B 4.3.1).
 *  Lowercase "about" matches the muted add-stops row styling. */
export function capacitySentence(remainingMin: number): string {
  return `about ${roundToQuarterHour(remainingMin)} minutes still open`;
}

/** Format a 0..24 hour as "h:mm" with no am/pm, e.g. 18 -> "6:00", 9 -> "9:00". */
function fmtHour(endHour: number): string {
  const h = endHour % 12 === 0 ? 12 : endHour % 12;
  return `${h}:00`;
}

/** "that's a full day, nothing else fits before 6:00" (FR-PATH-UX-10). */
export function fullDaySentence(endHour: number): string {
  return `that's a full day, nothing else fits before ${fmtHour(endHour)}`;
}
