# Team Page Declutter — Design Spec

**Date:** 2026-07-24
**Status:** Approved (pending spec review)
**Module:** Admin / Team page (`AgentsPage`) + coverage card + agent row/card
**Origin:** Design critique (28/40; aesthetic-and-minimalist scored 1). Page feels cluttered: a full-height "Team logging coverage" card lists every member as "No data", the roster is pushed below the fold, and long emails wrap to 3 lines ballooning every row. User approved a full pass (P0 to P2) and a visual preview.

---

## 1. Goals

Make the Team page lead with the roster, read as one scannable line per person, and demote the coverage insight. No restyle, work entirely within the existing design system and components. Behavior/layout only.

## 2. Changes (locked, per approved preview)

### 2.1 Coverage card: collapse when empty, move below roster (P0)
`TeamCoverageCard` (`apps/app/src/features/coverage/components/TeamCoverageCard.tsx`) currently always renders a `<ul>` of every rep with a "No data" chip for ungradeable reps.
- When **no** rep is gradeable (no coverage data at all), render only the existing one-line empty state; **omit the per-member list entirely**.
- When **some** reps have data, list **only** the gradeable reps (drop the "No data" rows). The headline pill + "N of M reps with data" line stays.
- In `AgentsPage`, move `<TeamCoverageCard />` from above the roster to **below** the list/org-chart section. Adjust its margin (it currently sets `mb-4`; switch to top spacing for its new position).

### 2.2 Single-line rows with truncated email (P1)
`AgentListRow.tsx` (desktop table) and `AgentCard.tsx` (mobile):
- The email renders on a **single line**, truncated with an ellipsis (`overflow: hidden; text-overflow: ellipsis; white-space: nowrap`), with the full address in a `title` attribute for hover. Give the email cell a bounded width so truncation actually triggers.
- Result: each person is one row height, no 3-line wrapping.

### 2.3 Roster is the headline (P1)
Consequence of 2.1: with coverage moved down, the leaderboard table (desktop) / cards (mobile) sit directly under the header as the primary content. No separate change beyond 2.1.

### 2.4 Header regrouping (P2)
In `AgentsPage` header:
- **Primary:** "Invite agent" as the single primary button.
- **Secondary:** "Import CSV".
- **View controls grouped:** the List / Org-chart toggle and the 7d / 30d / 90d range sit together as a visually grouped cluster, distinct from the action buttons.
- **Seat count** ("16 / 50") demoted to a quiet status chip (muted text, pill), not competing with the actions.
- Keep all existing controls and behavior; this is grouping/weighting only. Match the header pattern used elsewhere (e.g. DashboardPage `PageHeading`).

### 2.5 Mute zero-value metrics (P2)
In `AgentListRow.tsx` / `AgentCard.tsx`, numeric/currency cells that are zero or empty (`$0`, `0`, `—`, `$0 (0)`, `0%` win rate with no deals) render in muted text (`text-text-subtle`) so non-zero values (real pipeline, won, activities) stand out. Non-zero values keep default emphasis. A won/lost of zero may collapse from `$0 (0)` to a single muted `–` for calm.

## 3. Non-goals

- No visual restyle, color system, fonts, and component look are unchanged.
- No change to sorting, filtering, the RPC, permissions, or the org-chart tree structure.
- No change to what columns exist in the table (only their zero-state emphasis).
- The invite-management-in-org-chart gap (separate earlier discussion) is out of scope here.

## 4. Testing

- `TeamCoverageCard`: unit/component test that with all-ungradeable rows it renders the empty-state line and **no** per-member `<li>`; with a mix, it lists only gradeable reps.
- Row truncation: a component test asserting the email cell carries the truncation classes + a `title` attribute equal to the full email (desktop row and mobile card).
- Zero-muting: a test that a zero metric cell carries the muted class and a non-zero one does not (a small pure helper, e.g. `isZeroMetric(value)`, is acceptable and unit-tested; keep formatting logic pure where practical).
- Existing `AgentsPage` / coverage tests stay green; adjust only assertions that legitimately change (e.g. a test asserting the coverage list shows a "No data" row must be updated, and noted).
- Full `pnpm --filter app test` + `typecheck` green.

## 5. Files (anticipated)

- `apps/app/src/features/coverage/components/TeamCoverageCard.tsx` (+ test) — collapse/empty logic, list only gradeable.
- `apps/app/src/features/admin/pages/AgentsPage.tsx` — move coverage below roster; regroup header.
- `apps/app/src/features/admin/components/AgentListRow.tsx` (+ test) — email truncation, zero-muting.
- `apps/app/src/features/admin/components/AgentCard.tsx` — email truncation, zero-muting.
- Optional small pure helper for zero detection (co-located + tested).

## 6. Rollout

Frontend-only, no migration. Ships by pushing to main (their standard flow), verified via the full test suite + a visual check in the app.
