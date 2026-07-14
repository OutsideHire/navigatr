import { describe, it, expect } from "vitest";
import { canDeleteNote, formatNoteTimestamp, type PartnerNote } from "./partnerNotes";

function note(overrides: Partial<PartnerNote> = {}): PartnerNote {
  return {
    id: "n-1",
    partnerId: "p-1",
    createdBy: "user-1",
    body: "Prefers texts over calls",
    createdAt: "2026-07-14T12:00:00.000Z",
    authorName: "Sarah Johnson",
    ...overrides,
  };
}

describe("canDeleteNote", () => {
  it("lets the author delete their own note", () => {
    expect(canDeleteNote(note({ createdBy: "user-1" }), "user-1", "rep")).toBe(true);
  });

  it("blocks a rep from deleting someone else's note", () => {
    expect(canDeleteNote(note({ createdBy: "other" }), "user-1", "rep")).toBe(false);
  });

  it("lets a manager or admin delete any note", () => {
    expect(canDeleteNote(note({ createdBy: "other" }), "user-1", "manager")).toBe(true);
    expect(canDeleteNote(note({ createdBy: "other" }), "user-1", "admin")).toBe(true);
  });

  it("blocks deletion when signed out / role unknown", () => {
    expect(canDeleteNote(note({ createdBy: "other" }), undefined, undefined)).toBe(false);
  });
});

describe("formatNoteTimestamp", () => {
  it("renders a short month + day", () => {
    expect(formatNoteTimestamp("2026-07-14T12:00:00.000Z")).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
  });
});
