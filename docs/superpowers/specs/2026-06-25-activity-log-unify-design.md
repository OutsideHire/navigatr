# Activity Log — Fix & Unify Per-Deal Timeline — Design

**Goal:** Make the existing per-deal activity log show each activity's real type, reusing the same
type-aware presentation as the Activities History tab.

## Context

A persistent activity log already exists on both required surfaces:
- **Activities view** → History tab (all logged activities, newest first, type-filterable).
- **Pipeline record** → deal detail **Activity tab** (`ActivityList`, full per-deal history grouped
  by date) + a "Latest activity" card (3 + "View all" → Activity tab).

So no new log is needed. The real defect: the deal-side `ActivityRow`
([DealDetailPage.tsx:510-528](apps/app/src/features/pipeline/pages/DealDetailPage.tsx)) **hardcodes
every activity as a "Call" with a phone icon** — `title={`Call · … min · …`}` and a fixed
`PhoneIcon`. Email/drop-in/appointment activities logged on a deal are mislabeled. The Activities
History tab renders types correctly via local `TYPE_ICON` / `TYPE_ACCENT` / `TYPE_LABEL` maps.

## Design

### 1. Shared type metadata — `src/features/activities/lib/activityTypeMeta.ts` (new)
Move the three maps out of `ActivitiesPage.tsx` into a shared module so both surfaces use one source:
```ts
import { Calendar, Mail, MapPin, Phone, type LucideIcon } from "lucide-react";
import type { ActivityType } from "../mockData";

export const ACTIVITY_TYPE_ICON: Record<ActivityType, LucideIcon> = {
  call: Phone, email: Mail, drop_in: MapPin, appointment: Calendar,
};
export const ACTIVITY_TYPE_ACCENT: Record<ActivityType, { bg: string; fg: string }> = {
  call:        { bg: "bg-accent-teal-20",   fg: "text-accent-teal"   },
  email:       { bg: "bg-accent-blue-20",   fg: "text-accent-blue"   },
  drop_in:     { bg: "bg-accent-violet-20", fg: "text-accent-violet" },
  appointment: { bg: "bg-accent-orange-20", fg: "text-accent-orange" },
};
export const ACTIVITY_TYPE_LABEL: Record<ActivityType, string> = {
  call: "Call", email: "Email", drop_in: "Drop-in", appointment: "Appointment",
};
```

### 2. `ActivitiesPage.tsx`
Delete the local `TYPE_ICON` / `TYPE_ACCENT` / `TYPE_LABEL` consts; import the shared ones (aliased
back to the local names to minimize churn, or rename usages). Behavior unchanged.

### 3. `DealDetailPage.tsx` — fix `ActivityRow`
Use the shared maps + a type-aware title:
```tsx
const Icon = ACTIVITY_TYPE_ICON[activity.type];
const accent = ACTIVITY_TYPE_ACCENT[activity.type];
const title = [
  ACTIVITY_TYPE_LABEL[activity.type],
  activity.durationMinutes ? `${activity.durationMinutes} min` : null,
  spec.label,
].filter(Boolean).join(" · ");
```
Leading badge uses `accent.bg`/`accent.fg` + `<Icon />` instead of the hardcoded teal phone. The
`VoiceNotePlayer` block stays conditional on `voiceNoteUrl` (unchanged).

## Testing
- `activityTypeMeta.test.ts` — every `ActivityType` has an icon, accent (bg+fg), and label.
- `DealDetailPage.latest-activity.test.tsx` — add a case: an **email** activity renders "Email …"
  (not "Call") in the Latest activity card. The existing call-type "≤3 rows" assertions stay green.

## Risks
- Pure presentation/refactor; no data-model or behavior change. The only user-visible change is
  correct type labels/icons on the deal activity log.
