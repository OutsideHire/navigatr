# Activities by Sales Rep & Company Report — Design Spec

**Date:** 2026-07-23
**Status:** Approved (pending spec review)
**Module:** Sales Reporting — dashboard
**Source user stories:** `User_Stories_Activities_By_Rep_Company.docx` (US-01..US-11)
**Reference visual:** https://haven-cover-93947853.figma.site/

---

## 1. Overview

A new read-only dashboard report that counts every logged activity (calls,
emails, visits, appointments) and breaks it down **by sales rep**, then lets a
manager expand any rep to see those same counts split **by company**. It gives
sales managers and leadership a team-wide activity picture, a ranked comparison
of reps, and a validated Grand Total.

This is distinct from the existing **Activities Report**
(`/dashboard/activity-to-win`), which is won-deal-centric (average touches per
closed deal). This new report is total activity *volume*, regardless of deal
outcome.

## 2. Key decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Placement | Standalone full-page report, new row in the dashboard "Additional reports" list | Each report stays focused; matches existing pattern. Not folded into Persistence Index (different lens: discipline vs volume). |
| Visibility | Managers and above only (sales_manager, director_sales, vp_sales, svp_sales, cso_cro, administrator) | For a single rep the "rep ranking" is one row. Gated on role_level via the capability map. |
| Attribution | By the rep who **owns** the deal/company (book of business) | Matches "assigned companies" language and how the rest of the dashboard groups (deal owner / RLS). |
| Data source | Query activity records directly, filtered by `occurred_at` | Time filter must change the numbers; deal-snapshot counts are lifetime cumulative and can't be date-scoped. |
| Export | Lightweight CSV only (v1) | Covers "share with leadership / offline". Full PDF + multi-sheet Excel deferred. |
| Header/chrome | Standard navigatr full-page header (title + subtitle + range control + back nav) | Gradient is reserved for the Activity-to-Win hero per DESIGN.md. No modal overlay. |
| Tip dismissal persistence | localStorage | Low-stakes UI preference; no server round-trip needed. |

## 3. Scope

**In scope**
- Standalone report screen gated to managers+.
- Five team-wide summary cards (Total, Calls, Emails, Visits, Appts) that double as sort selectors.
- Dismissible usage tip (persisted).
- Ranked rep list with rank badges + per-type counts.
- Expandable per-rep company breakdown table with a Subtotal row.
- Grand Total panel.
- Time-period filter (30d / 90d / 6mo / all-time, default 90d).
- CSV export.
- Responsive layout.

**Out of scope (v1)**
- Editing/creating activities or company assignments (read-only).
- Non-activity (pipeline/forecast) analysis.
- PDF and multi-sheet Excel export.
- Reps opening the report for a self-only view.

## 4. Data model

Activity records (`activities` table) carry: `org_id`, `deal_id` (not null),
`logged_by`, `type` (`call` | `email` | `appointment` | `drop_in`),
`occurred_at`. Each deal has an owner and a company.

- **Type mapping (display):** `call` → Calls, `email` → Emails, `drop_in` → Visits, `appointment` → Appointments/Appts. Total = sum of the four.
- **Rep** = the owner of the deal the activity belongs to.
- **Company** = the deal's company.
- **Range filter** = `occurred_at` within the selected window.

Fetch is RLS-scoped (managers see their team automatically). Aggregation is
done in **pure, unit-tested functions** over the fetched rows:
- `activitiesByRep(rows) → RepActivity[]` (per rep: company count, per-type counts, total).
- `companiesForRep(rows, ownerId) → CompanyActivity[]` (per company: per-type counts, total) + subtotal.
- `grandTotal(rows) → { total, call, email, dropin, appointment }`.
- `sortReps(reps, metric) → RepActivity[]` (desc by the selected metric).
- Each aggregate must reconcile: rep subtotal == rep headline; sum of rep totals == Grand Total == summary cards.

## 5. Screen layout (top to bottom)

1. **Header** — title "Activities by sales rep and company", subtitle "Total activity breakdown for each representative", range control, back navigation. Standard header (no gradient).
2. **Summary cards** (US-02, US-03) — five cards; each shows icon + team-wide count. Clicking sets the sort metric (highlighted with accent border + tint). Default selected: Total. Values update with the filter.
3. **Usage tip** (US-04) — light-blue background, bold "Tip:", dismissible, persisted via localStorage.
4. **Ranked rep list** (US-05) — per rep: rank badge (1st amber, 2nd gray, 3rd red, 4th+ purple/neutral), name, "X companies · Y total activities", and the four per-type counts with colored icons. Sorted by the active metric (default Total desc). Scrolls if long.
5. **Per-rep drill-down** (US-06) — chevron (right collapsed / down expanded); clicking expands a table: Company, Calls, Emails, Visits, Appointments, Total. Numeric columns right-aligned, Total bold. Subtotal row matches the rep headline. Independent expansion state per rep (multiple open at once).
6. **Grand Total panel** (US-07) — "Grand total · all representatives", light-blue background + blue border accent, five large color-coded numbers with labels, matching the summary cards.

## 6. Visual language (US-08)

Consistent color + icon per activity type everywhere (cards, rep rows, drill-down, grand total):

| Type | Color | Icon |
|---|---|---|
| Total | purple | chart |
| Calls | blue | phone |
| Emails | green | envelope/mail |
| Visits (drop-in) | orange | people/users |
| Appointments | pink/magenta | calendar |

Colors map to the navigatr design-system accent tokens; must meet WCAG AA
against their backgrounds.

## 7. Filters (US-09)

Reuse the dashboard date-range presets: Last 30 Days, Last 90 Days, Last 6
Months, All Time. **Default: Last 90 Days** (report-specific default; the
dashboard default is 30d). Selecting a range refreshes summary cards, rep list,
open drill-downs, and Grand Total. One active at a time, highlighted.

## 8. Export (US-10, reduced scope)

Single "Export CSV" button. One flat CSV with a row per rep×company:
`Rep, Company, Calls, Emails, Visits, Appointments, Total`, plus a trailing
Grand Total row. Filename includes the active range and generation date. Pure
CSV builder (unit-tested); no new heavy dependency. PDF/Excel deferred.

## 9. Responsive (US-11)

- 360px–1920px.
- Summary cards: 5-across on desktop; wrap to 2–3 per row under ~768px.
- Drill-down table horizontally scrollable on narrow viewports.
- Rep rows remain tappable/expandable; tap targets meet WCAG AA.

## 10. Empty / edge states

- No activities in range → friendly empty state ("No activity logged in this period").
- A rep with companies but zero activity in range is excluded from the list (they have no rows in-window).
- Unassigned-owner activities: grouped under an "Unassigned" rep bucket only if such rows exist; otherwise omitted.

## 11. Testing

Per project TDD norms: unit tests for every aggregation/sort/CSV function
(including the reconciliation invariants in §4), and component tests for
card-sort selection, drill-down expand/collapse, tip dismissal persistence, and
the manager-only gate. No existing tests may break.

## 12. Files (anticipated)

- `apps/app/src/features/dashboard/lib/repCompanyActivity.ts` (+ test) — pure aggregation/sort/CSV.
- `apps/app/src/features/dashboard/hooks/useRepCompanyActivity.ts` — RLS-scoped fetch of in-range activities joined to deal owner/company.
- `apps/app/src/features/dashboard/pages/ActivitiesByRepCompanyReport.tsx` (+ test) — the screen.
- `DashboardPage.tsx` `AdditionalReports` — new gated row + route wiring in `App.tsx`.
- Capability/role gate reused from `features/auth/capabilities.ts`.
