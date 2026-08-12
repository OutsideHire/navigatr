# Create-path Phase A — default-industries preference + editor + settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The two UI components (`IndustryEditor`, `PathSettings`) are functional design-system baselines here; a later `frontend-design` pass polishes them.

**Goal:** Let a rep save a per-rep **default industry set** (category → sub-type), edit it in a picks-first `IndustryEditor`, and manage it from a Path Settings sheet — the data/editor foundation the Create-path step-1 redesign (Phase B) builds on.

**Architecture:** A `path_preferences` table (owner RLS, `default_industries` JSONB) + a `usePathPreferences` read/update hook with a Recommended fallback. A pure `lib/industrySelection.ts` defines the `IndustrySelection` shape + helpers (sourced from the existing `industryTaxonomy.ts`). `IndustryEditor` (picks-first, category→sub-type) and a `PathSettings` Radix sheet (opened from a gear on the Path page) consume them.

**Tech Stack:** Supabase + RLS, supabase-js, TanStack Query, React, Radix Dialog, the `@/components/navigatr` design system, Vitest + Testing Library.

---

## Conventions

- Branch off `main`: `git checkout main && git pull && git checkout -b feat/create-path-default-industries`.
- Tests: `pnpm --filter app test <path>`; full gate `cd apps/app && pnpm typecheck && pnpm test`.
- Migration hand-applied to prod: `supabase db query --linked -f <file>` (NOT `db push`).
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- "kaboom from Bomb" stderr is expected.

## Spec

`docs/superpowers/specs/2026-06-04-create-path-filters-default-industries-design.md`. This plan implements **Phase A** (preference system + editor + settings). Phase B (Create step-1 redesign + sub-type filtering) is a later plan.

## Building blocks (already on main)

- `supabase/functions/_shared/industryTaxonomy.ts`: `INDUSTRIES: Record<IndustryKey, { key, label, tier, order, includedTypes }>`, `INDUSTRY_KEYS`. The 13 categories + "other"; Tier-1 = manufacturing, construction_trades, healthcare, professional_services, automotive. Importable in the FE (CreatePathWizard already imports `TIER_1_KEYS` from it).
- `mockData.ts`: `type MerchantCategory` (same keys as IndustryKey), `CATEGORY_LABEL: Record<MerchantCategory, string>`.
- RLS pattern + frontend hook pattern: `supabase/migrations/20260519000001_deals.sql`, `apps/app/src/features/pipeline/hooks/useDeals.ts` / `useCreateDeal.ts`. `profiles.id = auth.uid()`.

## File Structure

- **Create** `supabase/migrations/20260604000001_path_preferences.sql` — table + RLS.
- **Create** `apps/app/src/features/path/lib/industrySelection.ts` (+test) — `IndustrySelection` + helpers.
- **Create** `apps/app/src/features/path/hooks/usePathPreferences.ts` (+test) — read + update default industries.
- **Create** `apps/app/src/features/path/components/IndustryEditor.tsx` (+test) — picks-first editor.
- **Create** `apps/app/src/features/path/components/PathSettings.tsx` (+test) — settings sheet.
- **Modify** `apps/app/src/features/path/pages/PathPage.tsx` — a gear button that opens PathSettings.

---

## Task 1: `path_preferences` table + RLS

**Files:**
- Create: `supabase/migrations/20260604000001_path_preferences.sql`

No vitest (DB). Verified by SQL; behavior covered by the hook tests.

- [ ] **Step 1: Write the migration**

`supabase/migrations/20260604000001_path_preferences.sql`:
```sql
-- 20260604000001_path_preferences.sql
--
-- Per-rep Path preferences. v1 holds the default industry set (category →
-- selected sub-type/primary_type keys) that auto-applies to every new path.
-- Owner-scoped RLS keyed on auth.uid(). Extensible: future default_radius_m /
-- default_max_stops columns slot in. One row per rep.

create table path_preferences (
  user_id            uuid primary key references profiles(id) on delete cascade,
  default_industries jsonb not null default '{}'::jsonb,
  updated_at         timestamptz not null default now()
);

alter table path_preferences enable row level security;

create policy path_preferences_select on path_preferences for select using (user_id = auth.uid());
create policy path_preferences_insert on path_preferences for insert with check (user_id = auth.uid());
create policy path_preferences_update on path_preferences for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy path_preferences_delete on path_preferences for delete using (user_id = auth.uid());
```

- [ ] **Step 2: Apply to prod (hand-applied, not db push)**

Run: `supabase db query --linked -f supabase/migrations/20260604000001_path_preferences.sql`
Expected: success (empty rows envelope, no error). If it errors, STOP and report.

- [ ] **Step 3: Verify**

Run:
```bash
supabase db query --linked --output json "select tablename, rowsecurity from pg_tables where tablename='path_preferences';"
supabase db query --linked --output json "select count(*) as policies from pg_policies where tablename='path_preferences';"
```
Expected: `path_preferences` present, `rowsecurity=true`; `policies=4`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260604000001_path_preferences.sql
git commit -m "feat(path): path_preferences table with owner RLS"
```

---

## Task 2: `lib/industrySelection.ts` — selection model + helpers

**Files:**
- Create: `apps/app/src/features/path/lib/industrySelection.ts`
- Test: `apps/app/src/features/path/lib/industrySelection.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/app/src/features/path/lib/industrySelection.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  RECOMMENDED_SELECTION, allSubtypes, selectedCategories, subtypeCount,
  isFullySelected, matchesSelection, humanizeSubtype, type IndustrySelection,
} from "./industrySelection";

describe("industrySelection", () => {
  it("RECOMMENDED_SELECTION is the 5 Tier-1 categories, each fully selected", () => {
    const cats = selectedCategories(RECOMMENDED_SELECTION).sort();
    expect(cats).toEqual(["automotive", "construction_trades", "healthcare", "manufacturing", "professional_services"].sort());
    expect(isFullySelected(RECOMMENDED_SELECTION, "automotive")).toBe(true);
  });

  it("allSubtypes returns a category's includedTypes", () => {
    expect(allSubtypes("automotive")).toContain("car_repair");
  });

  it("subtypeCount + isFullySelected reflect partial vs full", () => {
    const sel: IndustrySelection = { automotive: ["car_repair", "tire_shop"] };
    const total = allSubtypes("automotive").length;
    expect(subtypeCount(sel, "automotive")).toEqual({ selected: 2, total });
    expect(isFullySelected(sel, "automotive")).toBe(false);
    const full: IndustrySelection = { automotive: allSubtypes("automotive") };
    expect(isFullySelected(full, "automotive")).toBe(true);
  });

  it("matchesSelection: category not selected → false", () => {
    expect(matchesSelection("car_repair", "automotive", {})).toBe(false);
  });

  it("matchesSelection: full category → any of its types matches", () => {
    const full: IndustrySelection = { automotive: allSubtypes("automotive") };
    expect(matchesSelection("car_repair", "automotive", full)).toBe(true);
  });

  it("matchesSelection: partial category → only listed sub-types match", () => {
    const sel: IndustrySelection = { automotive: ["car_repair"] };
    expect(matchesSelection("car_repair", "automotive", sel)).toBe(true);
    expect(matchesSelection("tire_shop", "automotive", sel)).toBe(false);
  });

  it("matchesSelection: null primary_type → matches its (selected) category, not dropped", () => {
    const sel: IndustrySelection = { automotive: ["car_repair"] };
    expect(matchesSelection(null, "automotive", sel)).toBe(true);
    expect(matchesSelection(null, "retail", sel)).toBe(false);
  });

  it("humanizeSubtype turns a raw type into a label", () => {
    expect(humanizeSubtype("car_repair")).toBe("Car repair");
    expect(humanizeSubtype("fast_food_restaurant")).toBe("Fast food restaurant");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter app test src/features/path/lib/industrySelection.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the module**

`apps/app/src/features/path/lib/industrySelection.ts`:
```ts
/**
 * Industry selection model — the single representation shared by path preferences,
 * the IndustryEditor, and (Phase B) the prospect sub-type filter. A category maps
 * to the sub-type (Google primary_type) keys selected within it; a category with
 * all its sub-types is fully selected, a subset is partial, absent is unselected.
 * Sub-types come from the shared taxonomy's includedTypes per category.
 */
import { INDUSTRIES, INDUSTRY_KEYS } from "../../../../../../supabase/functions/_shared/industryTaxonomy";
import type { MerchantCategory } from "../mockData";

export type IndustrySelection = Partial<Record<MerchantCategory, string[]>>;

/** The sub-types (primary_type keys) a category can contain. */
export function allSubtypes(category: MerchantCategory): string[] {
  return INDUSTRIES[category as keyof typeof INDUSTRIES]?.includedTypes ?? [];
}

/** Recommended = the Tier-1 categories, each fully selected. */
export const RECOMMENDED_SELECTION: IndustrySelection = INDUSTRY_KEYS.reduce<IndustrySelection>((acc, key) => {
  if (INDUSTRIES[key].tier === 1) acc[key as MerchantCategory] = [...INDUSTRIES[key].includedTypes];
  return acc;
}, {});

/** Categories with at least one sub-type selected. */
export function selectedCategories(sel: IndustrySelection): MerchantCategory[] {
  return (Object.keys(sel) as MerchantCategory[]).filter((c) => (sel[c]?.length ?? 0) > 0);
}

export function subtypeCount(sel: IndustrySelection, category: MerchantCategory): { selected: number; total: number } {
  return { selected: sel[category]?.length ?? 0, total: allSubtypes(category).length };
}

export function isFullySelected(sel: IndustrySelection, category: MerchantCategory): boolean {
  const { selected, total } = subtypeCount(sel, category);
  return total > 0 && selected === total;
}

/**
 * Filter predicate (Phase B): does a prospect (its category + primary_type) fall
 * within the selection? Category not selected → no. Null primary_type → keep
 * (don't drop a stop for a missing granular type). Full category → any type. Partial
 * → only listed sub-types.
 */
export function matchesSelection(
  primaryType: string | null,
  category: MerchantCategory,
  sel: IndustrySelection,
): boolean {
  const subs = sel[category];
  if (!subs || subs.length === 0) return false;
  if (primaryType == null) return true;
  if (isFullySelected(sel, category)) return true;
  return subs.includes(primaryType);
}

/** "car_repair" → "Car repair" (no curated sub-type label map yet). */
export function humanizeSubtype(type: string): string {
  const spaced = type.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
```
NOTE: confirm the relative import depth to `industryTaxonomy.ts` matches what `CreatePathWizard.tsx` uses (it imports `TIER_1_KEYS` from `../../../../../../supabase/functions/_shared/industryTaxonomy`). Copy that exact path. Confirm `MerchantCategory` keys are a subset of `IndustryKey` (they are — same strings); the `as keyof typeof INDUSTRIES` cast bridges the two nominal types.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter app test src/features/path/lib/industrySelection.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/path/lib/industrySelection.ts apps/app/src/features/path/lib/industrySelection.test.ts
git commit -m "feat(path): industry selection model + helpers"
```

---

## Task 3: `usePathPreferences` — read + update default industries

**Files:**
- Create: `apps/app/src/features/path/hooks/usePathPreferences.ts`
- Test: `apps/app/src/features/path/hooks/usePathPreferences.test.tsx`

- [ ] **Step 1: Write the failing test**

`apps/app/src/features/path/hooks/usePathPreferences.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { usePathPreferences, useUpdateDefaultIndustries } from "./usePathPreferences";
import { RECOMMENDED_SELECTION } from "../lib/industrySelection";

const maybeSingle = vi.fn();
const upsertSingle = vi.fn();
const upsert = vi.fn(() => ({ select: () => ({ single: upsertSingle }) }));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ select: () => ({ maybeSingle }), upsert }) },
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { user: { id: string } | null }) => unknown) => sel({ user: { id: "user-1" } }),
}));

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

beforeEach(() => { maybeSingle.mockReset(); upsert.mockClear(); upsertSingle.mockReset(); });

describe("usePathPreferences", () => {
  it("returns the saved default industries", async () => {
    maybeSingle.mockResolvedValueOnce({ data: { default_industries: { retail: ["clothing_store"] } }, error: null });
    const { result } = renderHook(() => usePathPreferences(), { wrapper: wrap(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ retail: ["clothing_store"] });
  });

  it("falls back to RECOMMENDED_SELECTION when there is no row", async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const { result } = renderHook(() => usePathPreferences(), { wrapper: wrap(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(RECOMMENDED_SELECTION);
  });

  it("falls back to RECOMMENDED_SELECTION when default_industries is empty", async () => {
    maybeSingle.mockResolvedValueOnce({ data: { default_industries: {} }, error: null });
    const { result } = renderHook(() => usePathPreferences(), { wrapper: wrap(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(RECOMMENDED_SELECTION);
  });
});

describe("useUpdateDefaultIndustries", () => {
  it("upserts the selection keyed on the user", async () => {
    upsertSingle.mockResolvedValueOnce({ data: { user_id: "user-1" }, error: null });
    const { result } = renderHook(() => useUpdateDefaultIndustries(), { wrapper: wrap(makeClient()) });
    await result.current.mutateAsync({ retail: ["clothing_store"] });
    expect(upsert).toHaveBeenCalledWith(
      { user_id: "user-1", default_industries: { retail: ["clothing_store"] }, updated_at: expect.any(String) },
      { onConflict: "user_id" },
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter app test src/features/path/hooks/usePathPreferences.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the hooks**

`apps/app/src/features/path/hooks/usePathPreferences.ts`:
```ts
/**
 * usePathPreferences — the rep's saved default industry selection (server-backed,
 * owner-scoped via RLS). Falls back to RECOMMENDED_SELECTION when there's no row
 * or an empty set, so a new rep always has a sensible default. useUpdateDefaultIndustries
 * upserts the one-row-per-rep preference.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { RECOMMENDED_SELECTION, selectedCategories, type IndustrySelection } from "../lib/industrySelection";

export const PATH_PREFS_QUERY_KEY = ["path", "preferences"] as const;

export function usePathPreferences() {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: [...PATH_PREFS_QUERY_KEY, userId],
    enabled: !!userId,
    queryFn: async (): Promise<IndustrySelection> => {
      const { data, error } = await supabase
        .from("path_preferences")
        .select("default_industries")
        .maybeSingle();
      if (error) throw error;
      const saved = (data?.default_industries ?? {}) as IndustrySelection;
      return selectedCategories(saved).length > 0 ? saved : RECOMMENDED_SELECTION;
    },
  });
}

export function useUpdateDefaultIndustries() {
  const qc = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  return useMutation({
    mutationFn: async (selection: IndustrySelection): Promise<void> => {
      if (!userId) throw new Error("Not signed in");
      const { error } = await supabase
        .from("path_preferences")
        .upsert(
          { user_id: userId, default_industries: selection, updated_at: new Date().toISOString() },
          { onConflict: "user_id" },
        )
        .select()
        .single();
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...PATH_PREFS_QUERY_KEY, userId] }),
  });
}
```
NOTE: if `tsc` flags supabase return typing on `.single()`, apply the `as unknown as` cast pattern used elsewhere in this codebase. The test mock's `from()` returns `{ select, upsert }`; `select().maybeSingle()` is the read, `upsert().select().single()` is the write — matches the hook.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter app test src/features/path/hooks/usePathPreferences.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/path/hooks/usePathPreferences.ts apps/app/src/features/path/hooks/usePathPreferences.test.tsx
git commit -m "feat(path): usePathPreferences default-industries read/update"
```

---

## Task 4: `IndustryEditor` — picks-first editor (approach A)

**Files:**
- Create: `apps/app/src/features/path/components/IndustryEditor.tsx`
- Test: `apps/app/src/features/path/components/IndustryEditor.test.tsx`

- [ ] **Step 1: Write the failing test**

`apps/app/src/features/path/components/IndustryEditor.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IndustryEditor } from "./IndustryEditor";
import { allSubtypes, type IndustrySelection } from "../lib/industrySelection";

const RETAIL_FULL: IndustrySelection = { retail: allSubtypes("retail") };

describe("IndustryEditor", () => {
  it("shows the selected industries with sub-type counts", () => {
    render(<IndustryEditor value={RETAIL_FULL} scope="path" onUseForPath={vi.fn()} onSaveDefault={vi.fn()} />);
    expect(screen.getByText(/retail/i)).toBeInTheDocument();
    const total = allSubtypes("retail").length;
    expect(screen.getByText(new RegExp(`${total} of ${total}`, "i"))).toBeInTheDocument();
  });

  it("path scope: Use for this path returns the current selection", () => {
    const onUseForPath = vi.fn();
    render(<IndustryEditor value={RETAIL_FULL} scope="path" onUseForPath={onUseForPath} onSaveDefault={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /use for this path/i }));
    expect(onUseForPath).toHaveBeenCalledWith(RETAIL_FULL);
  });

  it("path scope: Save as default returns the current selection", () => {
    const onSaveDefault = vi.fn();
    render(<IndustryEditor value={RETAIL_FULL} scope="path" onUseForPath={vi.fn()} onSaveDefault={onSaveDefault} />);
    fireEvent.click(screen.getByRole("button", { name: /save as default/i }));
    expect(onSaveDefault).toHaveBeenCalledWith(RETAIL_FULL);
  });

  it("Add industries reveals a picker of not-yet-selected categories; adding selects all its sub-types", () => {
    const onUseForPath = vi.fn();
    render(<IndustryEditor value={RETAIL_FULL} scope="path" onUseForPath={onUseForPath} onSaveDefault={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /add industries/i }));
    fireEvent.click(screen.getByRole("button", { name: /^automotive$/i })); // pick from the revealed list
    fireEvent.click(screen.getByRole("button", { name: /use for this path/i }));
    const arg = onUseForPath.mock.calls[0][0] as IndustrySelection;
    expect(arg.automotive).toEqual(allSubtypes("automotive"));
    expect(arg.retail).toEqual(allSubtypes("retail"));
  });

  it("default scope: shows a single Save action", () => {
    const onSaveDefault = vi.fn();
    render(<IndustryEditor value={RETAIL_FULL} scope="default" onUseForPath={vi.fn()} onSaveDefault={onSaveDefault} />);
    expect(screen.queryByRole("button", { name: /use for this path/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSaveDefault).toHaveBeenCalledWith(RETAIL_FULL);
  });

  it("empty state offers Recommended", () => {
    render(<IndustryEditor value={{}} scope="default" onUseForPath={vi.fn()} onSaveDefault={vi.fn()} />);
    expect(screen.getByRole("button", { name: /use recommended/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter app test src/features/path/components/IndustryEditor.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the component**

`apps/app/src/features/path/components/IndustryEditor.tsx`:
```tsx
import * as React from "react";
import { Plus, X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/navigatr";
import { CATEGORY_LABEL, type MerchantCategory } from "../mockData";
import {
  RECOMMENDED_SELECTION, allSubtypes, selectedCategories, subtypeCount,
  humanizeSubtype, type IndustrySelection,
} from "../lib/industrySelection";

interface IndustryEditorProps {
  value: IndustrySelection;
  scope: "path" | "default";
  onUseForPath: (sel: IndustrySelection) => void;
  onSaveDefault: (sel: IndustrySelection) => void;
}

const ALL_CATEGORIES = (Object.keys(CATEGORY_LABEL) as MerchantCategory[]).filter((c) => c !== "other");

/**
 * IndustryEditor — picks-first (approach A). Shows only the rep's selected
 * industries (expandable to sub-types); "Add industries" reveals a picker of the
 * rest. Local working copy; the footer actions hand the selection up.
 */
export function IndustryEditor({ value, scope, onUseForPath, onSaveDefault }: IndustryEditorProps) {
  const [sel, setSel] = React.useState<IndustrySelection>(value);
  const [adding, setAdding] = React.useState(false);
  const [expanded, setExpanded] = React.useState<MerchantCategory | null>(null);

  const chosen = selectedCategories(sel);
  const addable = ALL_CATEGORIES.filter((c) => !chosen.includes(c));

  const addCategory = (c: MerchantCategory) => {
    setSel((s) => ({ ...s, [c]: allSubtypes(c) }));
    setAdding(false);
  };
  const removeCategory = (c: MerchantCategory) =>
    setSel((s) => { const next = { ...s }; delete next[c]; return next; });
  const toggleSubtype = (c: MerchantCategory, t: string) =>
    setSel((s) => {
      const cur = s[c] ?? [];
      const next = cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t];
      if (next.length === 0) { const cp = { ...s }; delete cp[c]; return cp; }
      return { ...s, [c]: next };
    });

  return (
    <div className="flex flex-col gap-3">
      {chosen.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-radius-md border border-dashed border-border-default p-4">
          <p className="text-body-md text-text-muted">Add the industries you sell to.</p>
          <Button variant="secondary" size="sm" onClick={() => setSel(RECOMMENDED_SELECTION)}>
            Use Recommended
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {chosen.map((c) => {
            const { selected, total } = subtypeCount(sel, c);
            const isOpen = expanded === c;
            return (
              <div key={c} className="rounded-radius-md border border-border-default">
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button type="button" onClick={() => setExpanded(isOpen ? null : c)}
                    className="flex flex-1 items-center justify-between text-left">
                    <span className="text-body-md font-medium text-text-default">{CATEGORY_LABEL[c]}</span>
                    <span className="flex items-center gap-1 text-caption text-text-muted">
                      {selected} of {total}
                      <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} aria-hidden />
                    </span>
                  </button>
                  <button type="button" aria-label={`Remove ${CATEGORY_LABEL[c]}`} onClick={() => removeCategory(c)}
                    className="rounded-radius-sm p-1 text-text-subtle hover:text-status-danger">
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </div>
                {isOpen && (
                  <div className="flex flex-col gap-1 border-t border-border-subtle px-3 py-2">
                    {allSubtypes(c).map((t) => (
                      <label key={t} className="flex items-center gap-2 text-body-md text-text-default">
                        <input type="checkbox" className="h-4 w-4 rounded border-border-default"
                          checked={(sel[c] ?? []).includes(t)} onChange={() => toggleSubtype(c, t)} />
                        {humanizeSubtype(t)}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {adding ? (
        <div className="flex flex-col gap-1 rounded-radius-md border border-border-default p-2">
          <span className="px-1 text-caption font-medium text-text-muted">Add an industry</span>
          {addable.map((c) => (
            <button key={c} type="button" onClick={() => addCategory(c)}
              className="rounded-radius-sm px-2 py-2 text-left text-body-md text-text-default hover:bg-surface-sunken">
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      ) : (
        <Button variant="secondary" size="sm" leadingIcon={Plus} onClick={() => setAdding(true)} className="self-start">
          Add industries
        </Button>
      )}

      <div className="flex gap-2 pt-1">
        {scope === "path" ? (
          <>
            <Button variant="primary" className="flex-1" onClick={() => onUseForPath(sel)}>Use for this path</Button>
            <Button variant="secondary" onClick={() => onSaveDefault(sel)}>Save as default</Button>
          </>
        ) : (
          <Button variant="primary" className="flex-1" onClick={() => onSaveDefault(sel)}>Save</Button>
        )}
      </div>
    </div>
  );
}
```
NOTE: the test queries categories by exact name (`/^automotive$/i`) in the Add picker — `CATEGORY_LABEL.automotive` is "Automotive" so the button name matches. Confirm `CATEGORY_LABEL` keys include all 13 (+ "other", filtered out). If `Button` needs a `type="button"` to avoid form submits, it already defaults appropriately for non-form usage.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter app test src/features/path/components/IndustryEditor.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `cd apps/app && pnpm typecheck 2>&1 | grep IndustryEditor` → no output.
```bash
git add apps/app/src/features/path/components/IndustryEditor.tsx apps/app/src/features/path/components/IndustryEditor.test.tsx
git commit -m "feat(path): IndustryEditor picks-first category/sub-type editor"
```

---

## Task 5: `PathSettings` sheet + gear entry on PathPage

**Files:**
- Create: `apps/app/src/features/path/components/PathSettings.tsx`
- Test: `apps/app/src/features/path/components/PathSettings.test.tsx`
- Modify: `apps/app/src/features/path/pages/PathPage.tsx`

- [ ] **Step 1: Write the failing test**

`apps/app/src/features/path/components/PathSettings.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PathSettings } from "./PathSettings";
import { allSubtypes } from "../lib/industrySelection";

const update = vi.fn();
vi.mock("../hooks/usePathPreferences", () => ({
  usePathPreferences: () => ({ data: { retail: allSubtypes("retail") }, isLoading: false }),
  useUpdateDefaultIndustries: () => ({ mutate: update, mutateAsync: vi.fn(async () => {}), isPending: false }),
}));

beforeEach(() => update.mockClear());

describe("PathSettings", () => {
  it("renders the Default industries section with the saved selection when open", () => {
    render(<PathSettings open onOpenChange={() => {}} />);
    expect(screen.getByText(/default industries/i)).toBeInTheDocument();
    expect(screen.getByText(/retail/i)).toBeInTheDocument();
  });

  it("Save persists the default industries", () => {
    render(<PathSettings open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(update).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter app test src/features/path/components/PathSettings.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write PathSettings**

`apps/app/src/features/path/components/PathSettings.tsx`:
```tsx
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { IndustryEditor } from "./IndustryEditor";
import { usePathPreferences, useUpdateDefaultIndustries } from "../hooks/usePathPreferences";
import type { IndustrySelection } from "../lib/industrySelection";

interface PathSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * PathSettings — a sheet to manage Path preferences. v1 section: Default
 * industries (edited via IndustryEditor in "default" scope; Save upserts the
 * per-rep preference). Mirrors the CreatePathWizard/PathPlanSheet dialog shell.
 */
export function PathSettings({ open, onOpenChange }: PathSettingsProps) {
  const { data: defaults } = usePathPreferences();
  const update = useUpdateDefaultIndustries();

  const handleSave = (sel: IndustrySelection) => {
    update.mutate(sel);
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[88dvh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-t-radius-lg bg-surface-default p-5 shadow-lg md:inset-0 md:bottom-auto md:top-1/2 md:max-h-[80dvh] md:-translate-y-1/2 md:rounded-radius-lg"
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-heading-sm text-text-default">Path settings</Dialog.Title>
            <Dialog.Close asChild>
              <button aria-label="Close" className="rounded-radius-sm p-1 text-text-muted hover:text-text-default">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-0.5">
              <h3 className="text-body-strong text-text-default">Default industries</h3>
              <p className="text-caption text-text-muted">Auto-applied to every new path. Edit any path without changing this.</p>
            </div>
            <IndustryEditor
              value={defaults ?? {}}
              scope="default"
              onUseForPath={() => {}}
              onSaveDefault={handleSave}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 4: Run PathSettings test**

Run: `pnpm --filter app test src/features/path/components/PathSettings.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the gear entry to PathPage**

In `apps/app/src/features/path/pages/PathPage.tsx`: import `Settings` from `lucide-react` and `PathSettings`; add `const [settingsOpen, setSettingsOpen] = React.useState(false);`. In the header button group, add a settings button (icon-only) before/after the existing actions:
```tsx
<Button variant="tertiary" size="sm" iconOnly leadingIcon={Settings} aria-label="Path settings" onClick={() => setSettingsOpen(true)} />
```
And mount the sheet alongside the other portals at the bottom of the return:
```tsx
<PathSettings open={settingsOpen} onOpenChange={setSettingsOpen} />
```
(If `Button` doesn't support `iconOnly`, check `Button.tsx` — it does, per the stories; otherwise use a plain icon button matching the close-button styling.)

- [ ] **Step 6: Full gate**

Run: `cd apps/app && pnpm typecheck && pnpm test`
Expected: typecheck clean; all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/app/src/features/path/components/PathSettings.tsx apps/app/src/features/path/components/PathSettings.test.tsx apps/app/src/features/path/pages/PathPage.tsx
git commit -m "feat(path): Path settings sheet + default-industries management"
```

---

## Task 6: Ship

- [ ] **Step 1: Final gate** — `cd apps/app && pnpm typecheck && pnpm test` (clean).
- [ ] **Step 2: Manual smoke (logged in):** open Path → gear → Path settings → Default industries shows Recommended (new rep) or saved set; add/remove a category, refine sub-types, Save → reopen shows it persisted (server). 
- [ ] **Step 3: Finish the branch** (superpowers:finishing-a-development-branch → merge to main + push; the migration is already applied to prod from Task 1, so no extra deploy. These components are dormant in the Create flow until Phase B wires step 1 — only the Path-settings gear is user-visible).

---

## Self-Review

**Spec coverage (Phase A):**
- `path_preferences` table + RLS → Task 1. ✅
- `IndustrySelection` model + helpers + Recommended fallback + `matchesSelection` (Phase-B filter predicate, defined now) → Task 2. ✅
- `usePathPreferences` read (Recommended fallback) + update → Task 3. ✅
- `IndustryEditor` (picks-first, category→sub-type, Add picker, Use-for-path vs Save-as-default, empty→Recommended) → Task 4. ✅
- Path Settings sheet + gear entry (manage defaults) → Task 5. ✅
- Create step-1 redesign + sub-type filtering in `proposeRoute`/`useMerchants` → **Phase B** (out of scope here; `matchesSelection` + the selection model are built now so Phase B is a wiring job). ✅

**Placeholder scan:** No TBD/TODO. Every code step has full code or an exact command. NOTEs are concrete verification instructions (import depth, `iconOnly` support) with fallbacks.

**Type consistency:** `IndustrySelection` (Task 2) is the currency in Tasks 3-5. `RECOMMENDED_SELECTION`/`allSubtypes`/`selectedCategories`/`subtypeCount` are defined in Task 2 and imported unchanged. `usePathPreferences`/`useUpdateDefaultIndustries` (Task 3) names match their use in PathSettings (Task 5). `IndustryEditor` props `{ value, scope, onUseForPath, onSaveDefault }` match how PathSettings (Task 5) and Phase B will call it. Migration column `default_industries` matches the hook's select/upsert.
