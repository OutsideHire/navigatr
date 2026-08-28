import { describe, it, expect } from "vitest";
import { repOutcomeLabel, repOutcomeSubtitle, REP_OUTCOME_LABELS } from "./outcomeRepLabels";
import { DISPOSITIONS } from "@/lib/followUpScheduling";

describe("outcomeRepLabels", () => {
  it("relabels the field drop-in outcomes with the desired rep wording", () => {
    expect(repOutcomeLabel("statement_secured")).toBe("Got their statement");
    expect(repOutcomeLabel("met_dm")).toBe("Met with decision maker");
    expect(repOutcomeLabel("scheduled_callback")).toBe("Asked me to come back");
    expect(repOutcomeLabel("not_in_office")).toBe("Closed right now");
    expect(repOutcomeLabel("closed_locked")).toBe("Not now");
    expect(repOutcomeLabel("out_of_business")).toBe("Out of business");
    expect(repOutcomeSubtitle("statement_secured")).toBe("Walked out with a statement");
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
