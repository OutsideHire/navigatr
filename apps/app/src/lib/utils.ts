import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * `cn` — Tailwind-aware className combiner.
 *
 * Uses `tailwind-merge` so later utilities win over earlier ones in the same
 * Tailwind "group" (e.g. `bg-red-500 bg-blue-500` → `bg-blue-500`). The merger
 * is extended below to register our custom font-size utilities.
 *
 * ============================================================================
 *  Why we extend tailwind-merge
 * ============================================================================
 *
 * Tailwind's stock font-size classes (`text-xs`, `text-base`, etc.) are
 * detected by `tailwind-merge` automatically — when you write
 * `text-base text-red-500`, it knows `text-base` is a font-size and
 * `text-red-500` is a text-color, so both survive.
 *
 * Our design system defines custom font-size utilities in tailwind.config.ts
 * (`text-body-md`, `text-caption`, `text-display-lg`, etc.). `tailwind-merge`
 * doesn't know these are font-sizes — it sees `text-<word>` and assumes
 * text-color. So when a component composes `text-caption` + `text-status-success`,
 * the merger thinks both are colors and drops the earlier one. Result:
 * `text-caption` silently disappears, the element renders at the default
 * font-size (16 px), and downstream "this looks cramped" complaints follow.
 *
 * The fix is to register every custom font-size utility under the `font-size`
 * class group below. Once registered, `tailwind-merge` correctly preserves
 * font-size + text-color when they coexist.
 *
 * Symptom this bug created in the wild: Badge rendering at fontSize 16 px
 * instead of 12 px (text-caption stripped), making 22 px pills feel like
 * they had no breathing room. Diagnosed via Claude Preview's live computed-
 * style read.
 *
 * **When you add a new font-size utility to tailwind.config.ts, add it here too.**
 * Keep these two lists in lockstep — there's no automated check yet.
 */

const NAVIGATR_FONT_SIZE_UTILITIES = [
  "display-xl",
  "display-lg",
  "display-md",
  "heading-xl",
  "heading-lg",
  "heading-md",
  "heading-sm",
  "body-lg",
  "body-md",
  "body-sm",
  "body-strong",
  "label",
  "caption",
  "eyebrow",
  "kpi-lg",
  "kpi-md",
  "kpi-sm",
  "code",
] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...NAVIGATR_FONT_SIZE_UTILITIES] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
