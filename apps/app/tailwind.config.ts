import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";
import {
  radius,
  spacing,
  fontFamily,
  typography,
  type TypographyKey,
} from "./src/tokens/tokens";

/**
 * Expand a typography token into Tailwind's `fontSize` tuple shape:
 *   [fontSize, { lineHeight, fontWeight, letterSpacing }]
 *
 * `text-transform` isn't supported in the tuple — eyebrow gets it via a base
 * style in src/index.css (`.text-eyebrow { text-transform: uppercase; }`).
 */
function ts(key: TypographyKey): [string, { lineHeight: string; fontWeight: number; letterSpacing: string }] {
  const t = typography[key];
  return [t.fontSize, { lineHeight: t.lineHeight, fontWeight: t.fontWeight, letterSpacing: t.letterSpacing }];
}

/**
 * Color groups bind to CSS variables defined in src/index.css. Light/dark
 * mode swap happens at the variable level, not in this config — that keeps
 * dark mode reactive to any class="dark" toggle without rebuilding utilities.
 */
const colorTokens = {
  surface: {
    canvas: "var(--color-surface-canvas)",
    default: "var(--color-surface-default)",
    elevated: "var(--color-surface-elevated)",
    sunken: "var(--color-surface-sunken)",
  },
  border: {
    DEFAULT: "var(--color-border-default)",
    subtle: "var(--color-border-subtle)",
    default: "var(--color-border-default)",
    strong: "var(--color-border-strong)",
  },
  text: {
    DEFAULT: "var(--color-text-default)",
    default: "var(--color-text-default)",
    muted: "var(--color-text-muted)",
    subtle: "var(--color-text-subtle)",
    inverse: "var(--color-text-inverse)",
  },
  brand: {
    primary: {
      DEFAULT: "var(--color-brand-primary)",
      hover: "var(--color-brand-primary-hover)",
      pressed: "var(--color-brand-primary-pressed)",
      foreground: "var(--color-brand-primary-foreground)",
      "10": "var(--color-brand-primary-10)",
    },
  },
  // Gradient stops live as flat color names so Tailwind's `from-` / `via-` /
  // `to-` utilities match the names verbatim (from-brand-gradient-from, etc.)
  "brand-gradient-from": "var(--color-brand-gradient-from)",
  "brand-gradient-via": "var(--color-brand-gradient-via)",
  "brand-gradient-to": "var(--color-brand-gradient-to)",
  status: {
    success: { DEFAULT: "var(--color-status-success)", bg: "var(--color-status-success-bg)" },
    warning: { DEFAULT: "var(--color-status-warning)", bg: "var(--color-status-warning-bg)" },
    danger: { DEFAULT: "var(--color-status-danger)", bg: "var(--color-status-danger-bg)" },
    info: { DEFAULT: "var(--color-status-info)", bg: "var(--color-status-info-bg)" },
  },
  accent: {
    teal: { DEFAULT: "var(--color-accent-teal)", "20": "var(--color-accent-teal-20)" },
    violet: { DEFAULT: "var(--color-accent-violet)", "20": "var(--color-accent-violet-20)" },
    blue: { DEFAULT: "var(--color-accent-blue)", "20": "var(--color-accent-blue-20)" },
    orange: { DEFAULT: "var(--color-accent-orange)", "20": "var(--color-accent-orange-20)" },
    indigo: { DEFAULT: "var(--color-accent-indigo)", "20": "var(--color-accent-indigo-20)" },
    pink: { DEFAULT: "var(--color-accent-pink)", "20": "var(--color-accent-pink-20)" },
  },
};

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: fontFamily.sans.split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")),
        mono: fontFamily.mono.split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")),
      },
      colors: colorTokens,
      spacing: {
        // Figma's `space0..space16` → Tailwind spacing scale. These mirror
        // Tailwind's defaults (1=4px, 2=8px, …) so existing utilities like
        // `p-4` (=16px) keep working; this just makes the mapping explicit.
        // `2.5: 10px` is a drift entry — see tokens.ts spacing comment.
        "0": spacing[0],
        "1": spacing[1],
        "2": spacing[2],
        "2.5": spacing["2.5"],
        "3": spacing[3],
        "4": spacing[4],
        "5": spacing[5],
        "6": spacing[6],
        "8": spacing[8],
        "10": spacing[10],
        "12": spacing[12],
        "16": spacing[16],
      },
      borderRadius: {
        // Token-name utilities (explicit per playbook): rounded-radius-md, etc.
        "radius-sm": radius.sm,
        "radius-md": radius.md,
        "radius-lg": radius.lg,
        "radius-full": radius.full,
        // Shorthand utilities (rounded-sm/md/lg) — same values, for shadcn.
        sm: radius.sm,
        md: radius.md,
        lg: radius.lg,
      },
      fontSize: {
        "display-xl": ts("display-xl"),
        "display-lg": ts("display-lg"),
        "display-md": ts("display-md"),
        "heading-xl": ts("heading-xl"),
        "heading-lg": ts("heading-lg"),
        "heading-md": ts("heading-md"),
        "heading-sm": ts("heading-sm"),
        "body-lg": ts("body-lg"),
        "body-md": ts("body-md"),
        "body-sm": ts("body-sm"),
        "body-strong": ts("body-strong"),
        label: ts("label"),
        caption: ts("caption"),
        eyebrow: ts("eyebrow"),
        "kpi-lg": ts("kpi-lg"),
        "kpi-md": ts("kpi-md"),
        "kpi-sm": ts("kpi-sm"),
        code: ts("code"),
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
