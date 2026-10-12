import { describe, it, expect } from "vitest";
import { PORTAL_LABELS, collapseHistory, portalLabel } from "./portalLabels";

describe("portalLabel", () => {
  it.each([
    ["submitted", "Received"],
    ["accepted", "Accepted"],
    ["working", "In Progress"],
    ["won", "Closed Won"],
    ["lost", "Not Moving Forward"],
    ["declined", "Not Moving Forward"],
    ["withdrawn", "Withdrawn"],
  ])("maps %s to %s", (status, label) => {
    expect(portalLabel(status)).toBe(label);
  });

  it("returns null for anything else, so a raw status can never leak", () => {
    expect(portalLabel("contacted")).toBeNull();
    expect(portalLabel("toString")).toBeNull();
    expect(portalLabel("")).toBeNull();
    expect(portalLabel(null)).toBeNull();
    expect(portalLabel(3)).toBeNull();
  });

  it("lists the six partner labels once each", () => {
    expect(PORTAL_LABELS).toEqual(["Received", "Accepted", "In Progress", "Closed Won", "Not Moving Forward", "Withdrawn"]);
  });
});

describe("collapseHistory", () => {
  it("maps to labels and keeps the first of consecutive identical labels", () => {
    expect(
      collapseHistory([
        { status: "submitted", at: "2026-10-01T10:00:00Z" },
        { status: "accepted", at: "2026-10-02T10:00:00Z" },
        { status: "working", at: "2026-10-03T10:00:00Z" },
        { status: "working", at: "2026-10-04T10:00:00Z" },
        { status: "lost", at: "2026-10-05T10:00:00Z" },
        { status: "declined", at: "2026-10-06T10:00:00Z" },
      ]),
    ).toEqual([
      { label: "Received", at: "2026-10-01T10:00:00Z" },
      { label: "Accepted", at: "2026-10-02T10:00:00Z" },
      { label: "In Progress", at: "2026-10-03T10:00:00Z" },
      { label: "Not Moving Forward", at: "2026-10-05T10:00:00Z" },
    ]);
  });

  it("does not collapse a label that returns after a different one", () => {
    expect(
      collapseHistory([
        { status: "working", at: "a" },
        { status: "lost", at: "b" },
        { status: "working", at: "c" },
      ]).map((h) => h.label),
    ).toEqual(["In Progress", "Not Moving Forward", "In Progress"]);
  });

  it("drops unknown statuses and missing timestamps", () => {
    expect(
      collapseHistory([
        { status: "mystery", at: "a" },
        { status: "submitted", at: null },
        { status: "won", at: "b" },
      ]),
    ).toEqual([{ label: "Closed Won", at: "b" }]);
  });
});
