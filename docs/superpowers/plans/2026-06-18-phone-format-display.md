# Phone number display formatting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Show formatted US phone numbers (`(512) 555-0100`) in the Optimized route preview by extracting the existing `libphonenumber-js` formatter into a shared util and reusing it.

**Architecture:** Lift the private `formatPhone` from `PhoneWithClickToCall.tsx` into `apps/app/src/lib/phone.ts` (single source of truth), refactor that component to import it (no behavior change), and use a `formatPhoneDisplay` convenience in `RoutePreview`.

**Tech Stack:** React + TypeScript, `libphonenumber-js` (already a dep), Vitest.

**Spec:** `/Users/ryanmeo/navigatr/docs/superpowers/specs/2026-06-18-phone-format-display-design.md`

Run pnpm from `/Users/ryanmeo/navigatr/.claude/worktrees/phone-format/apps/app`.

---

### Task 1: Extract `formatPhone` into `lib/phone.ts` (TDD)

**Files:**
- Create: `apps/app/src/lib/phone.ts`
- Create: `apps/app/src/lib/phone.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/lib/phone.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatPhone, formatPhoneDisplay } from "./phone";

describe("formatPhone", () => {
  it("formats a 10-digit US number to national format", () => {
    const r = formatPhone("5125550100");
    expect(r.display).toBe("(512) 555-0100");
    expect(r.valid).toBe(true);
    expect(r.e164).toBe("+15125550100");
  });

  it("formats an E.164 US number to national format", () => {
    const r = formatPhone("+15125550100");
    expect(r.display).toBe("(512) 555-0100");
    expect(r.valid).toBe(true);
    expect(r.e164).toBe("+15125550100");
  });

  it("passes through an invalid/short number", () => {
    const r = formatPhone("123");
    expect(r.display).toBe("123");
    expect(r.valid).toBe(false);
    expect(r.e164).toBeNull();
  });

  it("passes through an empty string", () => {
    const r = formatPhone("");
    expect(r.display).toBe("");
    expect(r.valid).toBe(false);
  });
});

describe("formatPhoneDisplay", () => {
  it("returns the national format for a valid US number", () => {
    expect(formatPhoneDisplay("+15125550100")).toBe("(512) 555-0100");
  });
  it("returns the raw string for an invalid number", () => {
    expect(formatPhoneDisplay("123")).toBe("123");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter app test phone`
Expected: FAIL — `Failed to resolve import "./phone"`.

- [ ] **Step 3: Create the util**

Create `apps/app/src/lib/phone.ts`:

```ts
/**
 * Phone display formatting — single source of truth, backed by libphonenumber-js.
 * US numbers render as national format `(512) 555-0100`; anything unparseable or
 * non-US falls back to the raw input (passthrough). Extracted from
 * PhoneWithClickToCall so list views (e.g. RoutePreview) can format consistently.
 */
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

/** Parse a phone string (US default) → display, e164, validity. Invalid input
 *  passes through as `display: raw`, `e164: null`, `valid: false`. */
export function formatPhone(raw: string, format: "us" | "international" = "us"): {
  display: string;
  e164: string | null;
  valid: boolean;
} {
  const parsed = parsePhoneNumberFromString(raw, "US" as CountryCode);
  if (!parsed || !parsed.isValid()) {
    return { display: raw, e164: null, valid: false };
  }
  const display = format === "us" && parsed.country === "US"
    ? parsed.formatNational()
    : parsed.formatInternational();
  return { display, e164: parsed.number, valid: true };
}

/** Display string only — formatted when parseable, raw passthrough otherwise. */
export function formatPhoneDisplay(raw: string): string {
  return formatPhone(raw).display;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter app test phone`
Expected: PASS (6 assertions across 2 describes).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/phone.ts apps/app/src/lib/phone.test.ts
git commit -m "feat(lib): extract formatPhone util (libphonenumber-js, US + passthrough)"
```

---

### Task 2: Reuse the util in `PhoneWithClickToCall` and `RoutePreview`

**Files:**
- Modify: `apps/app/src/components/navigatr/PhoneWithClickToCall.tsx`
- Modify: `apps/app/src/features/path/components/RoutePreview.tsx`

- [ ] **Step 1: Refactor `PhoneWithClickToCall.tsx` to import the shared util**

(a) Remove the now-unused direct import of libphonenumber-js. Replace:
```tsx
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
```
with:
```tsx
import { formatPhone } from "@/lib/phone";
```

(b) Delete the entire local `formatPhone` function definition (the
`function formatPhone(raw: string, format: ...) { ... }` block, ending at its closing
`}` just before the `export const PhoneWithClickToCall` line). The component already
calls `formatPhone(phoneNumber, displayFormat)` and `formatPhone(alt.phoneNumber, displayFormat)`
— those call sites are unchanged and now resolve to the imported function.

- [ ] **Step 2: Verify the component still behaves (its existing tests)**

Run: `pnpm --filter app test PhoneWithClickToCall`
Expected: PASS — behavior identical, only the function's location changed.

- [ ] **Step 3: Use `formatPhoneDisplay` in `RoutePreview.tsx`**

(a) Add the import (next to the other `@/lib` import):
```tsx
import { formatPhoneDisplay } from "@/lib/phone";
```

(b) In the stop row, replace the raw phone render:
```tsx
                        <Phone className="h-3.5 w-3.5" aria-hidden /> {m.phone}
```
with:
```tsx
                        <Phone className="h-3.5 w-3.5" aria-hidden /> {formatPhoneDisplay(m.phone)}
```

- [ ] **Step 4: Typecheck + full suite**

Run: `pnpm --filter app typecheck && pnpm --filter app test`
Expected: typecheck clean (no unused `parsePhoneNumberFromString`/`CountryCode` import left in the component); all tests green (phone, PhoneWithClickToCall, RoutePreview, and the rest).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/components/navigatr/PhoneWithClickToCall.tsx apps/app/src/features/path/components/RoutePreview.tsx
git commit -m "feat(path): format phone in RoutePreview via shared util; PhoneWithClickToCall reuses it"
```

---

## Notes for the implementer

- `libphonenumber-js` is already a dependency (`^1.13.1`) — no install needed.
- The extracted `formatPhone` must be byte-for-byte the same logic as the original so
  `PhoneWithClickToCall`'s existing tests pass unchanged.
- Do NOT change `tel:` href generation anywhere — it uses the e164/raw number, not the
  display string.
- Only these four files change across the two tasks.
