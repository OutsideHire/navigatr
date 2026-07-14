/**
 * partnerNotes — shared types + pure helpers for the append-only partner
 * notes feed. No React / Supabase imports so it stays trivially testable.
 */

export interface PartnerNote {
  id: string;
  partnerId: string;
  createdBy: string;
  body: string;
  /** ISO instant the note was written. */
  createdAt: string;
  /** Author's display name, or null if their profile isn't visible. */
  authorName: string | null;
}

/** A rep can delete their own note; managers/admins can delete any. Mirrors
 *  the partner_notes_delete RLS policy so the UI hides the affordance when
 *  the server would reject it. */
export function canDeleteNote(
  note: Pick<PartnerNote, "createdBy">,
  userId: string | undefined,
  role: string | undefined,
): boolean {
  if (role === "manager" || role === "admin") return true;
  return Boolean(userId) && note.createdBy === userId;
}

/** Short LOCAL date for a note. created_at is a true instant (when the note
 *  was written), so we render it in the viewer's local timezone — unlike the
 *  date-only fields in calendarDate.ts which use the UTC convention. */
export function formatNoteTimestamp(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
