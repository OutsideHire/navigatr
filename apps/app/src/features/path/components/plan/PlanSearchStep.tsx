/**
 * PlanSearchStep — step 2 of the Plan-a-Path wizard.
 *
 * Search-by-city/ZIP + the discovery filters that scope the ingest:
 *   - LocationSearch (bound to usePathOrigin.searchLocation) resolves the origin.
 *   - radius (5/10/15mi) — drives the Google ingest area.
 *   - min-employees select — a size floor kept in wizard state.
 *   - industry selection (IndustryEditor / IndustrySelection) with the merged
 *     Retail / Restaurants-Bars-Entertainment groups, plus an "All business types"
 *     toggle that fetches every bucket.
 *
 * Presentational: all state is owned by PlanPathWizard and passed in. Resolving an
 * origin (via LocationSearch) enables the footer Continue; the parent's Continue
 * advances to `results`. "Search businesses" both resolves the origin and, once
 * resolved, is the same gate the footer uses.
 */
import * as React from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, Checkbox, Select } from "@/components/navigatr";
import { CATEGORY_LABEL, type MerchantCategory } from "../../mockData";
import { LocationSearch } from "../LocationSearch";
import { IndustryEditor } from "../IndustryEditor";
import { selectedCategories, type IndustrySelection } from "../../lib/industrySelection";

/** Radius options (label → meters), matching PathPage / CreatePathWizard. */
const PLAN_RADIUS_OPTIONS: Array<{ label: string; meters: number }> = [
  { label: "5 mi", meters: 8047 },
  { label: "10 mi", meters: 16093 },
  { label: "15 mi", meters: 24140 },
];

/** Min-employees floor options. "Any" = 0 (no filter). */
const MIN_EMPLOYEES_OPTIONS: Array<{ label: string; value: number }> = [
  { label: "Any", value: 0 },
  { label: "5+", value: 5 },
  { label: "10+", value: 10 },
  { label: "25+", value: 25 },
  { label: "50+", value: 50 },
];

export interface PlanSearchStepProps {
  /** Whether an origin is resolved (drives Continue + the resolved banner). */
  originResolved: boolean;
  /** Human label for the resolved origin (city / ZIP). */
  originLabel: string | null;
  /** Search plumbing from usePathOrigin. */
  onSearch: (query: string) => void;
  searching: boolean;
  searchError: string | null;

  radiusM: number;
  onRadiusChange: (meters: number) => void;

  minEmployees: number;
  onMinEmployeesChange: (value: number) => void;

  selection: IndustrySelection;
  onSelectionChange: (sel: IndustrySelection) => void;
  allIndustries: boolean;
  onAllIndustriesChange: (all: boolean) => void;
}

export function PlanSearchStep({
  originResolved,
  originLabel,
  onSearch,
  searching,
  searchError,
  radiusM,
  onRadiusChange,
  minEmployees,
  onMinEmployeesChange,
  selection,
  onSelectionChange,
  allIndustries,
  onAllIndustriesChange,
}: PlanSearchStepProps) {
  const [editing, setEditing] = React.useState(false);
  const chosen = React.useMemo(() => selectedCategories(selection), [selection]);

  return (
    <div className="flex flex-col gap-5 md:mx-auto md:w-full md:max-w-2xl">
      <div className="flex flex-col gap-1">
        <h2 className="text-heading-md text-text-default">Where do you want to prospect?</h2>
        <p className="text-body-md text-text-muted">
          Search a city or ZIP, then tune the filters before we pull nearby businesses.
        </p>
      </div>

      {/* Location search */}
      <div className="flex flex-col gap-2">
        <span className="text-caption font-medium text-text-muted">Location</span>
        <LocationSearch onSearch={onSearch} searching={searching} error={searchError} autoFocus={!originResolved} />
        {originResolved && originLabel && (
          <p className="text-caption text-text-muted">
            Searching near <span className="font-medium text-text-default">{originLabel}</span>
          </p>
        )}
      </div>

      {/* Radius */}
      <div className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-text-muted">Search radius</span>
        <div className="flex gap-1 self-start rounded-radius-md bg-surface-sunken p-0.5">
          {PLAN_RADIUS_OPTIONS.map((opt) => (
            <button
              key={opt.meters}
              type="button"
              onClick={() => onRadiusChange(opt.meters)}
              aria-pressed={radiusM === opt.meters}
              className={cn(
                "inline-flex items-center rounded-radius-sm px-3 py-1.5 text-caption font-medium tabular-nums transition-colors",
                radiusM === opt.meters
                  ? "bg-surface-default text-text-default shadow-sm"
                  : "text-text-muted hover:text-text-default",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Min employees */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="plan-min-employees" className="text-caption font-medium text-text-muted">
          Minimum employees
        </label>
        <div className="w-40">
          <Select
            id="plan-min-employees"
            value={String(minEmployees)}
            onValueChange={(v) => onMinEmployeesChange(Number(v))}
            options={MIN_EMPLOYEES_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
          />
        </div>
      </div>

      {/* Industry selection */}
      <div className="flex flex-col gap-3 rounded-radius-md border border-brand-primary bg-surface-default p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-body-strong text-text-default">Business types</span>
            <span className="text-caption text-text-muted">Pick the industries you want to visit.</span>
          </div>
          {!editing && !allIndustries && (
            <Button variant="secondary" size="sm" leadingIcon={Pencil} onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </div>
        <Checkbox
          label="All business types"
          checked={allIndustries}
          onCheckedChange={(v) => {
            const on = v === true;
            onAllIndustriesChange(on);
            if (on) setEditing(false);
          }}
        />
        {allIndustries ? (
          <p className="text-caption text-text-muted">
            Every business type nearby is included. Turn off to pick specific industries.
          </p>
        ) : editing ? (
          <IndustryEditor
            value={selection}
            scope="path"
            onUseForPath={(sel) => {
              onSelectionChange(sel);
              setEditing(false);
            }}
            onSaveDefault={(sel) => {
              // Plan wizard doesn't persist a default (SP2 scope). Apply for this path.
              onSelectionChange(sel);
              setEditing(false);
            }}
          />
        ) : chosen.length === 0 ? (
          <p className="text-caption text-text-muted">No industries selected — Edit to choose.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {chosen.map((c) => (
              <span
                key={c}
                className="inline-flex h-7 items-center rounded-radius-full bg-surface-sunken px-3 text-caption font-medium text-text-default"
              >
                {CATEGORY_LABEL[c as MerchantCategory]}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default PlanSearchStep;
