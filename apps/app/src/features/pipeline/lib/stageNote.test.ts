import { describe, it, expect } from "vitest";
import { appendStageNote } from "./stageNote";

describe("appendStageNote", () => {
  it("returns existing unchanged when the note is empty", () => {
    expect(appendStageNote("old", "new", "contacted", "", "Jun 18")).toBe("old");
    expect(appendStageNote("old", "new", "contacted", "   ", "Jun 18")).toBe("old");
  });
  it("prepends a prefixed line when a note is given", () => {
    expect(appendStageNote("old notes", "new", "contacted", "Left a vm", "Jun 18"))
      .toBe("[New→Contacted · Jun 18] Left a vm\n\nold notes");
  });
  it("handles null/undefined existing notes", () => {
    expect(appendStageNote(null, "qualified", "proposal", "Sent quote", "Jun 18"))
      .toBe("[Qualified→Proposal · Jun 18] Sent quote\n\n");
  });
});
