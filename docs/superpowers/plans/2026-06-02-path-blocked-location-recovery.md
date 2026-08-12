# Path Blocked-Location Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the browser blocks location, make the Path page lead with the City/ZIP search and auto-recover (re-attempt GPS) the moment the rep re-enables the permission — no dead button, no required reload.

**Architecture:** Three existing units change, no new modules. `useGeolocation` gains an internal Permissions-API watcher that calls its existing `request()` on any permission change. `LocationSearch` gains an `autoFocus` prop. `PathPage`'s no-origin empty state splits into a search-first "blocked" variant (denied) and a "Try again" variant (unavailable).

**Tech Stack:** React + TypeScript, browser Geolocation + Permissions APIs, Vitest + Testing Library, Vercel (frontend deploy via `git push origin main`).

---

## Conventions

- Branch off `main`: `git checkout main && git pull && git checkout -b feat/path-blocked-location-recovery`.
- Tests: one file → `pnpm --filter app test <path>`; full gate → `cd apps/app && pnpm typecheck && pnpm test`.
- The intentional "kaboom from Bomb" stderr from a RouteErrorBoundary test is expected, not a failure.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Frontend-only change — no Supabase/Edge deploy. Ships via `git push origin main` → Vercel.

## File Structure

- **Modify** `apps/app/src/features/path/hooks/useGeolocation.ts` — add a permission-watch effect that re-`request()`s on permission change. No public API change.
- **Modify** `apps/app/src/features/path/hooks/useGeolocation.test.ts` — add a permission-change → re-request test; keep existing tests green.
- **Modify** `apps/app/src/features/path/components/LocationSearch.tsx` — add `autoFocus?: boolean`.
- **Modify** `apps/app/src/features/path/components/LocationSearch.test.tsx` — add focus / no-focus tests.
- **Modify** `apps/app/src/features/path/pages/PathPage.tsx` — split the no-origin empty state (denied vs unavailable) + pass `autoFocus={!origin}` to the search.
- **Modify** `apps/app/src/features/path/pages/PathPage.test.tsx` — update the denied test, add an unavailable test.

---

## Task 1: `useGeolocation` permission auto-recovery

**Files:**
- Modify: `apps/app/src/features/path/hooks/useGeolocation.ts`
- Test: `apps/app/src/features/path/hooks/useGeolocation.test.ts`

- [ ] **Step 1: Write the failing test**

In `useGeolocation.test.ts`, first extend the `afterEach` cleanup to also remove a stubbed permissions API. Find:
```ts
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis.navigator as unknown as { geolocation?: unknown }).geolocation;
  });
```
Replace with:
```ts
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis.navigator as unknown as { geolocation?: unknown }).geolocation;
    delete (globalThis.navigator as unknown as { permissions?: unknown }).permissions;
  });
```

Then add this test inside the `describe("useGeolocation", ...)` block:
```ts
  it("re-requests geolocation when the permission state changes", async () => {
    const getCurrentPosition = vi.fn((_ok, err) =>
      err?.({ code: 1, message: "denied" } as GeolocationPositionError),
    );
    mockGeolocation({ getCurrentPosition });

    // Fake PermissionStatus that captures the 'change' listener.
    let changeHandler: (() => void) | null = null;
    const permStatus = {
      state: "denied" as PermissionState,
      addEventListener: (_evt: string, h: () => void) => { changeHandler = h; },
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(globalThis.navigator, "permissions", {
      value: { query: vi.fn().mockResolvedValue(permStatus) },
      configurable: true,
    });

    const { result } = renderHook(() => useGeolocation());
    await waitFor(() => expect(result.current.status).toBe("denied"));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);

    // Simulate the user re-enabling location → permission 'change' fires.
    await waitFor(() => expect(changeHandler).not.toBeNull());
    await act(async () => { changeHandler!(); });
    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalledTimes(2));
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter app test src/features/path/hooks/useGeolocation.test.ts`
Expected: FAIL — the new test sees only 1 `getCurrentPosition` call (no watcher exists yet). Existing 6 tests still pass.

- [ ] **Step 3: Add the permission-watch effect**

In `useGeolocation.ts`, find the mount effect + return at the end of the hook:
```ts
  React.useEffect(() => {
    request();
  }, [request]);

  return { ...state, retry: request };
}
```
Replace with:
```ts
  React.useEffect(() => {
    request();
  }, [request]);

  // Auto-recover when the user re-enables location in browser settings: watch the
  // geolocation permission and re-request on any change (granted → silent fix;
  // reset-to-ask → re-prompt; blocked → harmless no-op). Best-effort — browsers
  // without the geolocation Permissions API (older Safari) skip this silently.
  React.useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return;
    let status: PermissionStatus | null = null;
    let cancelled = false;
    const onChange = () => request();
    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((s) => {
        if (cancelled) return;
        status = s;
        status.addEventListener("change", onChange);
      })
      .catch(() => {
        /* permission name unsupported — skip auto-recovery */
      });
    return () => {
      cancelled = true;
      status?.removeEventListener("change", onChange);
    };
  }, [request]);

  return { ...state, retry: request };
}
```
NOTE: if `tsc` rejects `{ name: "geolocation" as PermissionName }` (lib variance), the cast is already there; if it instead complains the cast is unnecessary, drop `as PermissionName` and use `{ name: "geolocation" }`. Either compiles depending on the TS lib version — pick whichever `pnpm typecheck` accepts.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter app test src/features/path/hooks/useGeolocation.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck**

Run: `cd apps/app && pnpm typecheck 2>&1 | grep useGeolocation`
Expected: NO output (file is clean).

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/features/path/hooks/useGeolocation.ts apps/app/src/features/path/hooks/useGeolocation.test.ts
git commit -m "feat(path): auto-recover geolocation when permission is re-enabled"
```
(Commit message ends with a blank line then the Co-Authored-By trailer.)

---

## Task 2: `LocationSearch` autoFocus

**Files:**
- Modify: `apps/app/src/features/path/components/LocationSearch.tsx`
- Test: `apps/app/src/features/path/components/LocationSearch.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `LocationSearch.test.tsx` inside the `describe` block:
```tsx
  it("focuses the input on mount when autoFocus is set", () => {
    render(<LocationSearch onSearch={vi.fn()} searching={false} error={null} autoFocus />);
    expect(screen.getByLabelText(/search by city or zip/i)).toHaveFocus();
  });

  it("does not focus the input when autoFocus is not set", () => {
    render(<LocationSearch onSearch={vi.fn()} searching={false} error={null} />);
    expect(screen.getByLabelText(/search by city or zip/i)).not.toHaveFocus();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter app test src/features/path/components/LocationSearch.test.tsx`
Expected: FAIL — `autoFocus` prop not accepted / input not focused.

- [ ] **Step 3: Add the `autoFocus` prop**

In `LocationSearch.tsx`, update the props interface — find:
```tsx
interface LocationSearchProps {
  onSearch: (query: string) => void;
  searching: boolean;
  error: string | null;
}
```
Replace with:
```tsx
interface LocationSearchProps {
  onSearch: (query: string) => void;
  searching: boolean;
  error: string | null;
  /** Focus the input on mount / when this becomes true (used by the blocked state). */
  autoFocus?: boolean;
}
```
Update the function signature — find:
```tsx
export function LocationSearch({ onSearch, searching, error }: LocationSearchProps) {
  const [query, setQuery] = React.useState("");
```
Replace with:
```tsx
export function LocationSearch({ onSearch, searching, error, autoFocus = false }: LocationSearchProps) {
  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);
```
Attach the ref to the `Input` — find the `<Input` element and add `ref={inputRef}` as its first prop. The element currently starts:
```tsx
          <Input
            size="sm"
            leadingIcon={MapPin}
```
Change to:
```tsx
          <Input
            ref={inputRef}
            size="sm"
            leadingIcon={MapPin}
```
(The DS `Input` is a `React.forwardRef<HTMLInputElement>`, so the ref lands on the underlying `<input>`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter app test src/features/path/components/LocationSearch.test.tsx`
Expected: PASS (6 tests — 4 existing + 2 new).

- [ ] **Step 5: Typecheck**

Run: `cd apps/app && pnpm typecheck 2>&1 | grep LocationSearch`
Expected: NO output.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/features/path/components/LocationSearch.tsx apps/app/src/features/path/components/LocationSearch.test.tsx
git commit -m "feat(path): LocationSearch supports autoFocus"
```
(Trailer as above.)

---

## Task 3: PathPage blocked vs unavailable empty states

**Files:**
- Modify: `apps/app/src/features/path/pages/PathPage.tsx`
- Test: `apps/app/src/features/path/pages/PathPage.test.tsx`

- [ ] **Step 1: Pass `autoFocus` to the location-bar search**

In `PathPage.tsx`, find (in the always-visible location bar):
```tsx
        <LocationSearch onSearch={searchLocation} searching={searching} error={searchError} />
```
Replace with:
```tsx
        <LocationSearch onSearch={searchLocation} searching={searching} error={searchError} autoFocus={!origin} />
```

- [ ] **Step 2: Rework the no-origin empty-state card**

Find the empty-state branch:
```tsx
      ) : !origin ? (
        <Card padding="lg" className="mt-6 flex flex-col items-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
            <MapPinOff className="h-6 w-6" aria-hidden />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-heading-sm text-text-default">We don&apos;t have your location yet</p>
            <p className="text-body-md text-text-muted">
              {geoStatus === "denied"
                ? "Location access is off. Enable it in your browser, or search a city or ZIP above to find prospects."
                : "We couldn't get your location. Use the button below, or search a city or ZIP above."}
            </p>
          </div>
          <Button variant="secondary" size="sm" leadingIcon={LocateFixed} onClick={useMyLocation}>
            Use my location
          </Button>
        </Card>
      ) : merchantsLoading ? (
```
Replace with:
```tsx
      ) : !origin ? (
        <Card padding="lg" className="mt-6 flex flex-col items-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
            <MapPinOff className="h-6 w-6" aria-hidden />
          </span>
          {geoStatus === "denied" ? (
            <>
              <div className="flex flex-col gap-1">
                <p className="text-heading-sm text-text-default">Location is blocked for this site</p>
                <p className="text-body-md text-text-muted">
                  Search a city or ZIP above to find prospects — or re-enable location in your
                  browser and it&apos;ll pick up automatically.
                </p>
              </div>
              <details className="text-caption text-text-muted">
                <summary className="cursor-pointer select-none">How to re-enable location</summary>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-left">
                  <li>Click the site-info icon (a lock or sliders) in your browser&apos;s address bar.</li>
                  <li>Set Location to &ldquo;Allow.&rdquo; This page updates on its own — no reload needed.</li>
                </ol>
              </details>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <p className="text-heading-sm text-text-default">We couldn&apos;t get your location</p>
                <p className="text-body-md text-text-muted">
                  Try again, or search a city or ZIP above to find prospects.
                </p>
              </div>
              <Button variant="secondary" size="sm" leadingIcon={LocateFixed} onClick={useMyLocation}>
                Try again
              </Button>
            </>
          )}
        </Card>
      ) : merchantsLoading ? (
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/app && pnpm typecheck`
Expected: ZERO errors.

- [ ] **Step 4: Update the PathPage tests**

In `PathPage.test.tsx`, find the existing denied test:
```tsx
  it("shows an empty state with search when GPS is denied and no manual location", () => {
    originState.current = { ...base, geoStatus: "denied" };
    render(<PathPage />, { wrapper });
    expect(screen.getByText(/don't have your location/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/search by city or zip/i)).toBeInTheDocument();
  });
```
Replace with:
```tsx
  it("shows the blocked state (search-first + how-to) when GPS is denied", () => {
    originState.current = { ...base, geoStatus: "denied" };
    render(<PathPage />, { wrapper });
    expect(screen.getByText(/location is blocked/i)).toBeInTheDocument();
    expect(screen.getByText(/how to re-enable location/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/search by city or zip/i)).toBeInTheDocument();
  });

  it("shows a Try again button when location is unavailable", () => {
    originState.current = { ...base, geoStatus: "unavailable" };
    render(<PathPage />, { wrapper });
    expect(screen.getByText(/couldn't get your location/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
```
Also find the "ready" test's stale assertion:
```tsx
    expect(screen.queryByText(/don't have your location/i)).not.toBeInTheDocument();
```
Replace with:
```tsx
    expect(screen.queryByText(/location is blocked/i)).not.toBeInTheDocument();
```

- [ ] **Step 5: Run the PathPage tests**

Run: `pnpm --filter app test src/features/path/pages/PathPage.test.tsx`
Expected: PASS (6 tests — the 3 prior branch tests, with the denied one updated, plus the new unavailable test = 6 total: loading, blocked-denied, unavailable, ready, merchants-loading, merchants-error retry).

- [ ] **Step 6: Full gate**

Run: `cd apps/app && pnpm typecheck && pnpm test`
Expected: typecheck clean; all tests pass (the "kaboom from Bomb" stderr is expected, not a failure).

- [ ] **Step 7: Commit**

```bash
git add apps/app/src/features/path/pages/PathPage.tsx apps/app/src/features/path/pages/PathPage.test.tsx
git commit -m "feat(path): search-first blocked state + Try again for unavailable"
```
(Trailer as above.)

---

## Task 4: Ship

**Files:** none.

- [ ] **Step 1: Final gate on the branch tip**

Run: `cd apps/app && pnpm typecheck && pnpm test`
Expected: clean typecheck, all tests pass.

- [ ] **Step 2: Merge to main + push (frontend-only → Vercel auto-deploys)**

This follows the same finishing flow as the prior feature (the controller will use superpowers:finishing-a-development-branch). Net effect:
```bash
git checkout main && git pull
git merge --ff-only feat/path-blocked-location-recovery   # or a normal merge if not FF
cd apps/app && pnpm install && pnpm typecheck && pnpm test  # re-sync deps + verify on merged main
git push origin main
```
Vercel auto-builds `main`. No Edge/Supabase deploy needed (frontend-only).

- [ ] **Step 3: Verify on the deployed site**

In an incognito window (fresh permission state + service worker), open `/path` with location blocked → confirm the "Location is blocked" card with the auto-focused City/ZIP search and the "How to re-enable location" details. Set Location → Allow in site settings → confirm the page auto-loads GPS without a click or reload (auto-recovery). Deny again and confirm search still works.

---

## Self-Review

**Spec coverage:**
- Search-first blocked state (no dead button, how-to details, auto-focused search) → Task 3 Steps 1-2. ✅
- Live auto-recovery via Permissions API → Task 1. ✅
- `unavailable` keeps "Try again" → Task 3 Step 2. ✅
- Manual selection still wins → unchanged `usePathOrigin` resolution (auto-recovery only fills a null origin; no code change needed, noted in spec). ✅
- Graceful when Permissions API absent → Task 1 Step 3 (feature-detect + `.catch`); existing useGeolocation tests (which don't stub `navigator.permissions`) still pass, exercising the absent path. ✅
- Tests for all three units → Tasks 1, 2, 3. ✅
- Frontend-only ship → Task 4. ✅

**Placeholder scan:** No TBD/TODO. Every code step shows complete before/after. The one NOTE (the `as PermissionName` cast) gives a concrete either/or resolved by typecheck, not a placeholder.

**Type consistency:** `autoFocus?: boolean` defined in Task 2 and consumed as `autoFocus={!origin}` in Task 3. `geoStatus` values (`"denied"`/`"unavailable"`) match `GeoStatus` from `useGeolocation`. `PermissionStatus`/`PermissionName`/`PermissionState` are DOM lib types. The permission-watch effect uses the existing `request` (stable `useCallback`) as its dep — consistent with the mount effect.
