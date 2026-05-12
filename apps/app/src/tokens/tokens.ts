/**
 * Design tokens for navigatr.
 *
 * Colors / spacing / radius are sourced from the Figma variables export at
 * `apps/app/src/tokens/figma-export.json` (re-run `pnpm tokens:normalize`
 * after any fresh export).
 *
 * Typography is hand-authored from `docs/DESIGN.md` §Typography — the Figma
 * file's Variables panel doesn't carry text styles, so this is the source of
 * truth for the 16+ text styles used across the app.
 *
 * Consumers:
 *  - `tailwind.config.ts` reads the typography + radius scales here
 *  - `src/index.css` writes the color values to CSS variables for both modes
 *  - features can import token objects directly if they need a runtime value
 */

import figmaExport from "./figma-export.json";

// ============================================================================
// COLORS — sourced from figma-export.json
// ============================================================================

const fl = figmaExport.colors.light;
const fd = figmaExport.colors.dark;

/**
 * Reshape Figma's flat camelCase keys (`surfaceCanvas`, `accentTeal20`) into
 * nested groups so Tailwind generates utilities like `bg-surface-canvas`,
 * `bg-accent-teal-20`, `text-text-default`.
 */
function colorsFor(m: typeof fl) {
  return {
    surface: {
      canvas: m.surfaceCanvas,
      default: m.surfaceDefault,
      elevated: m.surfaceElevated,
      sunken: m.surfaceSunken,
    },
    border: {
      subtle: m.borderSubtle,
      default: m.borderDefault,
      strong: m.borderStrong,
    },
    text: {
      default: m.textDefault,
      muted: m.textMuted,
      subtle: m.textSubtle,
      inverse: m.textInverse,
    },
    brand: {
      primary: m.brandPrimary,
      primaryHover: m.brandPrimaryHover,
      primaryPressed: m.brandPrimaryPressed,
      primaryForeground: m.brandPrimaryForeground,
      primary10: m.brandPrimary10,
    },
    brandGradient: {
      from: m.brandGradientFrom,
      via: m.brandGradientVia,
      to: m.brandGradientTo,
    },
    status: {
      success: m.statusSuccess,
      successBg: m.statusSuccessBg,
      warning: m.statusWarning,
      warningBg: m.statusWarningBg,
      danger: m.statusDanger,
      dangerBg: m.statusDangerBg,
      info: m.statusInfo,
      infoBg: m.statusInfoBg,
    },
    accent: {
      teal: m.accentTeal,
      teal20: m.accentTeal20,
      violet: m.accentViolet,
      violet20: m.accentViolet20,
      blue: m.accentBlue,
      blue20: m.accentBlue20,
      orange: m.accentOrange,
      orange20: m.accentOrange20,
      indigo: m.accentIndigo,
      indigo20: m.accentIndigo20,
      pink: m.accentPink,
      pink20: m.accentPink20,
    },
  } as const;
}

export type ColorMode = "light" | "dark";

export const colors = {
  light: colorsFor(fl),
  dark: colorsFor(fd),
} as const;

export type ColorScale = typeof colors.light;

// ============================================================================
// SPACING — sourced from figma-export.json (numbers → px strings)
// ============================================================================

const fs = figmaExport.spacing.mode1;

/**
 * Spacing scale.
 *
 * `2.5: 10px` is a **drift entry** — the Figma Button component (node
 * 19:300, Size=lg) uses 10px for its icon gap, but the Spacing variable
 * collection in Figma only has 8 and 12 as adjacent named tokens (no 10).
 * Until Figma adds a named token here, we carry 10px as `2.5` to match
 * Tailwind's default scale and let the Button's lg gap utility resolve
 * cleanly. Once Figma adds `space2.5` (or whatever name), bind this entry
 * to that variable.
 */
export const spacing = {
  0: `${fs.space0}px`,
  1: `${fs.space1}px`, // 4
  2: `${fs.space2}px`, // 8
  "2.5": "10px", // drift — see comment above
  3: `${fs.space3}px`, // 12
  4: `${fs.space4}px`, // 16
  5: `${fs.space5}px`, // 20
  6: `${fs.space6}px`, // 24
  8: `${fs.space8}px`, // 32
  10: `${fs.space10}px`, // 40
  12: `${fs.space12}px`, // 48
  16: `${fs.space16}px`, // 64
} as const;

// ============================================================================
// RADIUS — sourced from figma-export.json
// ============================================================================

const fr = figmaExport.radius.mode1;

export const radius = {
  sm: `${fr.radiusSm}px`, // 6
  md: `${fr.radiusMd}px`, // 10
  lg: `${fr.radiusLg}px`, // 14
  full: `${fr.radiusFull}px`, // 9999
} as const;

// ============================================================================
// TYPOGRAPHY — hand-authored from docs/DESIGN.md
// ============================================================================

export interface TypographyToken {
  fontFamily: string;
  fontSize: string;
  lineHeight: string;
  fontWeight: number;
  letterSpacing: string;
  textTransform?: "uppercase" | "none";
}

const INTER =
  "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO =
  "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";

/**
 * 18 text styles. Sourced from docs/DESIGN.md §Typography (14 styles defined
 * there) + 4 bridge sizes (heading-xl, body-sm, kpi-sm) the playbook expects.
 *
 * Each entry shape matches Tailwind's `fontSize` tuple format so the Tailwind
 * config can spread it directly: `[fontSize, { lineHeight, fontWeight, letterSpacing }]`.
 */
export const typography = {
  // -- Marketing / hero (avoid inside the app per DESIGN.md anti-pattern #5) --
  "display-xl": {
    fontFamily: INTER,
    fontSize: "48px",
    lineHeight: "56px",
    fontWeight: 700,
    letterSpacing: "-0.02em",
  },
  "display-lg": {
    fontFamily: INTER,
    fontSize: "40px",
    lineHeight: "48px",
    fontWeight: 700,
    letterSpacing: "-0.02em",
  },
  "display-md": {
    fontFamily: INTER,
    fontSize: "32px",
    lineHeight: "40px",
    fontWeight: 600,
    letterSpacing: "-0.01em",
  },

  // -- Headings (in-app) --
  "heading-xl": {
    // bridge size; not in DESIGN.md but expected by playbook
    fontFamily: INTER,
    fontSize: "28px",
    lineHeight: "36px",
    fontWeight: 600,
    letterSpacing: "-0.01em",
  },
  "heading-lg": {
    fontFamily: INTER,
    fontSize: "24px",
    lineHeight: "32px",
    fontWeight: 600,
    letterSpacing: "0em",
  },
  "heading-md": {
    fontFamily: INTER,
    fontSize: "20px",
    lineHeight: "28px",
    fontWeight: 600,
    letterSpacing: "0em",
  },
  "heading-sm": {
    fontFamily: INTER,
    fontSize: "16px",
    lineHeight: "24px",
    fontWeight: 600,
    letterSpacing: "0em",
  },

  // -- Body --
  "body-lg": {
    fontFamily: INTER,
    fontSize: "16px",
    lineHeight: "24px",
    fontWeight: 400,
    letterSpacing: "0em",
  },
  "body-md": {
    fontFamily: INTER,
    fontSize: "14px",
    lineHeight: "20px",
    fontWeight: 400,
    letterSpacing: "0em",
  },
  "body-sm": {
    // bridge size; not in DESIGN.md but expected by playbook
    fontFamily: INTER,
    fontSize: "13px",
    lineHeight: "18px",
    fontWeight: 400,
    letterSpacing: "0em",
  },
  "body-strong": {
    fontFamily: INTER,
    fontSize: "14px",
    lineHeight: "20px",
    fontWeight: 600,
    letterSpacing: "0em",
  },

  // -- Labels & micro --
  label: {
    fontFamily: INTER,
    fontSize: "13px",
    lineHeight: "18px",
    fontWeight: 500,
    letterSpacing: "0em",
  },
  caption: {
    fontFamily: INTER,
    fontSize: "12px",
    lineHeight: "16px",
    fontWeight: 400,
    letterSpacing: "0em",
  },
  eyebrow: {
    fontFamily: INTER,
    fontSize: "11px",
    lineHeight: "16px",
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  },

  // -- KPI --
  "kpi-lg": {
    fontFamily: INTER,
    fontSize: "56px",
    lineHeight: "60px",
    fontWeight: 700,
    letterSpacing: "-0.02em",
  },
  "kpi-md": {
    fontFamily: INTER,
    fontSize: "32px",
    lineHeight: "36px",
    fontWeight: 700,
    letterSpacing: "-0.01em",
  },
  "kpi-sm": {
    // bridge size; not in DESIGN.md but expected by playbook
    fontFamily: INTER,
    fontSize: "20px",
    lineHeight: "28px",
    fontWeight: 700,
    letterSpacing: "0em",
  },

  // -- Code --
  code: {
    fontFamily: MONO,
    fontSize: "13px",
    lineHeight: "20px",
    fontWeight: 500,
    letterSpacing: "0em",
  },
} as const satisfies Record<string, TypographyToken>;

export type TypographyKey = keyof typeof typography;

// ============================================================================
// FONT STACKS
// ============================================================================

export const fontFamily = {
  sans: INTER,
  mono: MONO,
} as const;
