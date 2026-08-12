import { describe, it, expect } from "vitest";

import { agingStateFromBand, agingReasonTextClass } from "./agingState";

describe("agingStateFromBand (v2.2 B 4.6)", () => {
  it("maps in_window -> neutral (before the target date)", () => {
    expect(agingStateFromBand("in_window")).toBe("neutral");
  });
  it("maps past_ideal -> warm (past the target date)", () => {
    expect(agingStateFromBand("past_ideal")).toBe("warm");
  });
  it("maps aging -> hot (past the latest acceptable date)", () => {
    expect(agingStateFromBand("aging")).toBe("hot");
  });
  it("maps undefined -> neutral (no band known)", () => {
    expect(agingStateFromBand(undefined)).toBe("neutral");
  });
  it("maps not-yet-open / pinned bands -> neutral (color encodes aging only)", () => {
    expect(agingStateFromBand("not_yet_open")).toBe("neutral");
    expect(agingStateFromBand("pinned")).toBe("neutral");
  });
});

describe("agingReasonTextClass", () => {
  it("neutral -> muted, warm -> warning, hot -> danger", () => {
    expect(agingReasonTextClass("neutral")).toBe("text-text-muted");
    expect(agingReasonTextClass("warm")).toBe("text-status-warning");
    expect(agingReasonTextClass("hot")).toBe("text-status-danger");
  });
});
