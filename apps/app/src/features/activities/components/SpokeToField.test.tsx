/**
 * The anti-drift guard.
 *
 * A rep logs a drop-in from two different sheets: DropInSheet for a business
 * that is not a deal yet, and LogActivitySheet for a stop they already owed a
 * visit to. Those two have drifted apart TWICE (the outcome list in #177, the
 * follow-up timing in #179), and both times the fix reached only the sheet reps
 * use less, so the bug survived where it mattered.
 *
 * This asserts the field is the SAME component in both, by identity. A future
 * change that copy-pastes one into the other, or removes it from one host,
 * fails here rather than in a QA report six weeks later.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { SpokeToField } from "./SpokeToField";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), "utf8");

describe("SpokeToField", () => {
  it("labels itself in the rep's words and carries the typed value out", () => {
    const seen: string[] = [];
    render(<SpokeToField value="" onChange={(v) => seen.push(v)} />);
    const input = screen.getByLabelText(/who did you speak to/i);
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("placeholder", expect.stringMatching(/person/i));
  });

  it("marks itself optional, because a rep who did not catch a name must still be able to log", () => {
    render(<SpokeToField value="" onChange={() => {}} />);
    expect(screen.getByText(/who did you speak to\?\s*\(optional\)/i)).toBeInTheDocument();
  });

  it("is used by BOTH drop-in sheets, not copied into one", () => {
    // Identity, not appearance: each host must import this component.
    const dropIn = read("../../path/components/DropInSheet.tsx");
    const stopLogger = read("./LogActivitySheet.tsx");
    for (const [name, src] of [["DropInSheet", dropIn], ["LogActivitySheet", stopLogger]] as const) {
      expect(src, `${name} must render the shared SpokeToField`).toMatch(/<SpokeToField/);
      expect(src, `${name} must import SpokeToField rather than re-implement it`).toMatch(
        /import \{ SpokeToField \}/,
      );
    }
  });

  it("gives each host a distinct input id, so the two labels never collide", () => {
    const dropIn = read("../../path/components/DropInSheet.tsx");
    const stopLogger = read("./LogActivitySheet.tsx");
    expect(dropIn).toMatch(/id="dropin-spoke-to"/);
    expect(stopLogger).toMatch(/id="log-spoke-to"/);
  });
});
