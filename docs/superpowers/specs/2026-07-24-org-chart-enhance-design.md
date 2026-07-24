# Org Chart Enhancement — Design Spec

**Date:** 2026-07-24
**Status:** Approved (pending spec review)
**Module:** Admin / Team page org-chart view (`OrgChartTree`)
**Origin:** Design critique of the org-chart view. Verdict: the indented-tree structure is right (scales to 7 layers, mobile-safe, no horizontal overflow), but the execution is bare and reads like a file tree. User approved enhancing the tree (not switching to a boxes-and-lines chart).

---

## 1. Goal

Make `OrgChartTree` read clearly as an org chart while keeping its scalable, mobile-friendly indented structure. Four additive enhancements, no structural/behavioral change to expand/collapse, click-to-detail, or accessibility.

## 2. Changes (locked, per approved preview)

All in `apps/app/src/features/admin/components/OrgChartTree.tsx`. The pure `buildOrgTree` (orgTree.ts) is unchanged; `node.children.length` already gives direct reports.

### 2.1 Connector rails (P1)
Replace depth-based inline `paddingLeft` (`style={{ paddingLeft: depth * 20 + 4 }}`) with **nested indentation via a left rail**: each nested `<ul>` (children) gets a left border + left padding (`border-l border-border-subtle` + `pl-*`), so a vertical guide line runs down each parent's subtree and the reporting relationship is visible. The root `<ul>` (depth 0) has no rail. `depth` is no longer needed for padding (indentation comes from nesting); keep passing it only if still used elsewhere, otherwise drop it.

### 2.2 Initials avatars (P2)
Render the navigatr `Avatar` before the name: `<Avatar alt={name} size="xs" />` (24px, initials fallback with a deterministic per-name accent color; already built). Anchors each person visually.

### 2.3 Role as a chip (P2)
Render the role level as a small quiet pill instead of plain muted text: a bordered pill (`rounded-radius-full border border-border-subtle px-2 py-0.5 text-caption text-text-muted`) showing `roleLabel(row.role_level)`. Keep the existing invited/revoked status `Badge` (colored) as-is, after the role chip.

### 2.4 Direct-report count (P2)
For a node with children, show a muted count after the role chip: `${n} ${n === 1 ? "report" : "reports"}` where `n = node.children.length` (direct reports only), styled `text-caption text-text-muted`. Leaf nodes (no reports) show nothing.

## 3. Preserve (no change)
- Expand/collapse chevron (default expanded), `aria-expanded`, `aria-label`.
- Name is a button firing `onSelect(agent_id)`; chevron is a separate button.
- Name truncation (`truncate`) so long names/emails don't wrap.
- Empty state ("No team members to chart yet.").
- Keyboard/AT accessibility (real buttons, focus rings).
- The forest ordering from `buildOrgTree` (sibling sort by role rank then name).

## 4. Non-goals
- No boxes-and-lines/node-graph layout.
- No metrics (pipeline/activity) in the chart, that's the List view's job.
- No change to `buildOrgTree`, the RPC, or the List view.
- No horizontal-scrolling layout; the tree stays vertical.

## 5. Testing
`OrgChartTree.test.tsx` (extend if present; else create):
- A manager node renders its direct-report count with correct pluralization (e.g. a node with 2 children shows "2 reports"; 1 child shows "1 report"; a leaf shows no count).
- Each person renders an avatar with initials derived from the name (assert the initials text, e.g. "SV" for "Sam Vance", appears).
- The role chip renders the role label.
- Existing behavior stays green: expand/collapse toggles children visibility; clicking a name fires `onSelect`; nested lists carry the rail class.
- Full `pnpm --filter app test` + `typecheck` green; no existing org-chart / AgentsPage tests break.

## 6. Files
- `apps/app/src/features/admin/components/OrgChartTree.tsx` (+ `OrgChartTree.test.tsx`).

## 7. Rollout
Frontend-only, no migration. Ships by pushing to main; verified via the full suite + a visual check in the app (demo org has a 7-layer tree to see rails + counts).
