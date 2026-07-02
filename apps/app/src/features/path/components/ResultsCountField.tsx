/**
 * ResultsCountField — the rep-configurable "results count" control.
 *
 * How many nearby businesses the discovery fetch returns/shows (the pool size),
 * NOT the number of stops auto-added to the route (that's the separate "Max
 * stops" cap in CreatePathWizard). Default 25, clamped to [1, 50] — mirrors the
 * discover_prospects Edge function's DEFAULT_LIMIT / MAX_LIMIT.
 *
 * A free-entry number Input (same shell as CreatePathWizard's stop-cap field):
 * kept as text while editing so the field can be cleared without snapping the
 * cursor; onBlur clamps + writes the resolved value back up.
 */
import * as React from "react";

import { Input } from "@/components/navigatr";
import {
  DEFAULT_RESULTS_LIMIT,
  MAX_RESULTS_LIMIT,
} from "../hooks/useMerchants";

export interface ResultsCountFieldProps {
  /** Current results count (already clamped by the owner). */
  value: number;
  /** Called with the clamped [1, MAX_RESULTS_LIMIT] value on change/blur. */
  onChange: (count: number) => void;
  /** Input id for the label association (defaults to "results-count"). */
  id?: string;
}

/** Clamp free text to a valid results count, falling back to the default. */
function clampCount(text: string): number {
  return Math.min(
    MAX_RESULTS_LIMIT,
    Math.max(1, parseInt(text, 10) || DEFAULT_RESULTS_LIMIT),
  );
}

export function ResultsCountField({
  value,
  onChange,
  id = "results-count",
}: ResultsCountFieldProps) {
  const [text, setText] = React.useState<string>(String(value));

  // Keep the field in sync when the owner resets/changes the value externally
  // (e.g. wizard re-open) without clobbering an in-progress edit.
  React.useEffect(() => {
    setText(String(value));
  }, [value]);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-caption font-medium text-text-muted">
        Results
      </label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        max={MAX_RESULTS_LIMIT}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = parseInt(e.target.value, 10);
          if (!Number.isNaN(parsed)) onChange(clampCount(e.target.value));
        }}
        onBlur={() => {
          const clamped = clampCount(text);
          setText(String(clamped));
          onChange(clamped);
        }}
        placeholder={String(DEFAULT_RESULTS_LIMIT)}
      />
      <span className="text-caption text-text-muted">
        How many to show (max {MAX_RESULTS_LIMIT})
      </span>
    </div>
  );
}

export default ResultsCountField;
