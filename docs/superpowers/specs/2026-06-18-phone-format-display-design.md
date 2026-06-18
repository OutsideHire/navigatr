# Phone number display formatting (2026-06-18)

## Problem

The Optimized route preview (`RoutePreview`) renders each stop's phone as a raw
E.164 string (e.g. `+15125550100`). It should read as a formatted US number
(`(512) 555-0100`).

## Key finding (reuse, don't reinvent)

A `formatPhone(raw, format?)` helper already exists — backed by `libphonenumber-js`
(a project dependency) — but is a **private function inside**
`apps/app/src/components/navigatr/PhoneWithClickToCall.tsx`. It already does exactly
what we want: US numbers → `parsed.formatNational()` = `(512) 555-0100`, and
**passthrough** (returns the raw string) when parsing fails or the number is invalid.

Rather than hand-roll a regex formatter, **extract that function into a shared util**
and reuse it. `RoutePreview` is in fact the *only* place in the Path flow that prints a
raw E.164: RunningPath shows a "Call" button (no number), SelectStops shows no phone, and
MerchantDetailSheet already uses `PhoneWithClickToCall` (already formatted).

## Decisions (locked in brainstorming)

- **US format, passthrough others** — exactly the existing helper's behavior.
- **Apply in RoutePreview only.** RunningPath's "Call" button stays as-is (no number shown).
- **Extract the existing formatter to `apps/app/src/lib/phone.ts`** as the single source of
  truth; `PhoneWithClickToCall` imports it (no behavior change).

## Architecture

### A. `apps/app/src/lib/phone.ts` (new)
Move the existing function verbatim and add a thin display-only convenience:

```ts
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

### B. `PhoneWithClickToCall.tsx` (refactor, no behavior change)
Delete the local `formatPhone` definition; `import { formatPhone } from "@/lib/phone";`.
Everything else (the `{display, e164, valid}` consumption) is unchanged.

### C. `RoutePreview.tsx` (use it)
`import { formatPhoneDisplay } from "@/lib/phone";` and render `{formatPhoneDisplay(m.phone)}`
in the stop row instead of `{m.phone}`.

## Testing

`apps/app/src/lib/phone.test.ts`:
- 10-digit US (`"5125550100"`) → `"(512) 555-0100"`, `valid: true`, `e164: "+15125550100"`.
- E.164 US (`"+15125550100"`) → `"(512) 555-0100"`, `valid: true`.
- Invalid/short (`"123"`) → `display: "123"`, `valid: false`, `e164: null` (passthrough).
- Empty string → `display: ""`, `valid: false`.
- `formatPhoneDisplay` returns the formatted string for a valid US number and the raw
  string for an invalid one.

`PhoneWithClickToCall` already has its own tests — they must still pass after the import
swap (behavior unchanged). RoutePreview's existing tests still pass (phone now formatted,
but the tests don't assert on the raw phone string).

## Out of scope

International display formatting beyond what the existing helper already does; formatting
RunningPath's Call button; touching SelectStops; any change to `tel:` href generation
(still uses the e164/raw number).
