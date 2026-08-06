import { describe, it, expect } from "vitest";
import { formatLogConfirmation, type LogConfirmation } from "./logConfirmation";

const NOW = new Date(2026, 7, 6); // 2026-08-06 local

const base: LogConfirmation = {
  activityType: "call",
  createdTasks: [],
  compound: false,
  recordEffects: [],
};

describe("formatLogConfirmation", () => {
  it("titles by the logged activity type", () => {
    expect(formatLogConfirmation({ ...base, activityType: "drop_in" }, NOW).title).toBe("Drop-in logged");
  });

  it("states 'No follow-up scheduled' for a terminal outcome", () => {
    expect(formatLogConfirmation(base, NOW).lines).toEqual(["No follow-up scheduled."]);
  });

  it("names the created task with a relative due date", () => {
    const c: LogConfirmation = {
      ...base,
      createdTasks: [{ type: "call", title: "Acme", targetAt: "2026-08-09" }],
    };
    expect(formatLogConfirmation(c, NOW).lines[0]).toBe("Call task created, due in 3 days");
  });

  it("marks a drop-in follow-up as reaching the Path", () => {
    const c: LogConfirmation = {
      ...base,
      activityType: "drop_in",
      createdTasks: [{ type: "drop_in", title: "Acme", targetAt: "2026-08-07" }],
    };
    expect(formatLogConfirmation(c, NOW).lines[0]).toBe("Drop-in task created, due tomorrow · shows on your Path");
  });

  it("lists both tasks for the send-info compound", () => {
    const c: LogConfirmation = {
      ...base,
      compound: true,
      createdTasks: [
        { type: "email", title: "Acme", targetAt: "2026-08-06" },
        { type: "call", title: "Acme", targetAt: "2026-08-11" },
      ],
    };
    const { lines } = formatLogConfirmation(c, NOW);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("Email task created, due today");
    expect(lines[1]).toBe("Call task created, due in 5 days");
  });

  it("appends record-state effects", () => {
    const c: LogConfirmation = { ...base, recordEffects: ["Phone number flagged as invalid"] };
    expect(formatLogConfirmation(c, NOW).lines).toContain("Phone number flagged as invalid");
  });
});
