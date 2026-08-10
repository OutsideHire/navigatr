/**
 * Plain-language day-capacity sentences (FR-PATH-UX-10).
 *
 * Pure helpers that turn the assembler's remaining-capacity number into the two
 * readings the "Your day" screen shows at the end of the list: how much time is
 * still open, or (when nothing more fits) a calm full-day statement in place of
 * a disabled control.
 */

/** Round to the nearest 10 minutes for a calm, non-false-precision reading. */
function roundTo10(min: number): number {
  return Math.max(0, Math.round(min / 10) * 10);
}

/** "about 50 minutes still open" (FR-PATH-UX-10). */
export function capacitySentence(remainingMin: number): string {
  return `about ${roundTo10(remainingMin)} minutes still open`;
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
