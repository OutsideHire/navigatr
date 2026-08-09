import { describe, it, expect } from "vitest";
import { repOutcomeLabel, repOutcomeSubtitle, REP_OUTCOME_LABELS } from "./outcomeRepLabels";
import { DISPOSITIONS } from "@/lib/followUpScheduling";

describe("outcomeRepLabels", () => {
  it("relabels the ten drop-in outcomes with casual wording", () => {
    expect(repOutcomeLabel("statement_secured")).toBe("Got statements");
    expect(repOutcomeLabel("connected_with_dm")).toBe("Met the owner");
    expect(repOutcomeLabel("wrong_number")).toBe("Wrong place");
    expect(repOutcomeLabel("closed_lost")).toBe("Dead");
  });
  it("falls back to the formal DISPOSITIONS label for non-drop-in dispositions", () => {
    expect(repOutcomeLabel("voicemail")).toBe(DISPOSITIONS.voicemail.label);
  });
  it("falls back to the DISPOSITIONS rationale for an unmapped subtitle", () => {
    expect(repOutcomeSubtitle("voicemail")).toBe(DISPOSITIONS.voicemail.rationale);
  });
  it("every mapped subtitle is interval-free (no day counts)", () => {
    for (const key of Object.keys(REP_OUTCOME_LABELS)) {
      expect(repOutcomeSubtitle(key as never)).not.toMatch(/\d/);
    }
  });
});
