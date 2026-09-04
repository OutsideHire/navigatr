/**
 * colorShades.ts: derive the full brand CSS-variable set from one primary.
 *
 * An ISO picks a single brand color; we derive everything the design system
 * needs so any color looks finished in BOTH light and dark mode:
 *   - primary / hover / pressed : the button states (darker on light,
 *     lighter on dark, matching how a pressed state reads on each ground)
 *   - foreground : readable button TEXT (near-black or white by luminance),
 *     so a pale accent doesn't get white-on-white
 *   - tint10 : 10%-alpha selected-row background
 *   - gradient from/via/to : an analogous sweep off the accent hue, so
 *     gradient surfaces follow the brand instead of staying navigatr indigo
 *
 * In dark mode a dark accent is lightened first (mirrors the design system's
 * dark primary, a lightened indigo) so it stays vivid on a dark surface.
 *
 * Colors are manipulated in HSL, the cheapest model for "same hue, different
 * lightness"; RGB math would shift hue near pure red/green/blue.
 */

export interface BrandVars {
  primary: string;
  hover: string;
  pressed: string;
  /** Readable button text on `primary`. */
  foreground: string;
  /** 10%-alpha version, formatted #rrggbbaa (matches design tokens). */
  tint10: string;
  gradientFrom: string;
  gradientVia: string;
  gradientTo: string;
}

/**
 * Build the full brand variable set for one hex primary + the current mode.
 * Returns null if the input isn't a #rrggbb (caller falls back to the design
 * system defaults).
 */
export function deriveBrandVars(hex: string, isDark: boolean): BrandVars | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const baseHsl = rgbToHsl(rgb);

  // Effective primary for the mode. Dark mode lifts a dark accent so it stays
  // vivid on a dark surface; light mode uses the accent as-is.
  const primaryHsl = isDark
    ? withL(baseHsl, Math.min(0.82, Math.max(baseHsl.l + 0.12, 0.58)))
    : baseHsl;
  const primary = hslToHex(primaryHsl);

  // Hover/pressed: darker in light mode, lighter in dark mode.
  const hover = hslToHex(withL(primaryHsl, primaryHsl.l + (isDark ? 0.06 : -0.04)));
  const pressed = hslToHex(withL(primaryHsl, primaryHsl.l + (isDark ? 0.12 : -0.12)));

  // Button text: whichever of near-black / white reads on the primary.
  const foreground = relLuminance(primary) > 0.5 ? "#16181f" : "#ffffff";

  // Analogous gradient swept off the accent hue (from -> +24deg -> +48deg),
  // brightening slightly along the sweep so it reads as a gradient.
  const gradientFrom = primary;
  const gradientVia = hslToHex(withL(rotateHue(primaryHsl, 24), Math.min(0.72, primaryHsl.l + 0.04)));
  const gradientTo = hslToHex(withL(rotateHue(primaryHsl, 48), Math.min(0.78, primaryHsl.l + 0.08)));

  return {
    primary,
    hover,
    pressed,
    foreground,
    tint10: primary + "19", // 0x19 = 25/255 ~ 10% alpha
    gradientFrom,
    gradientVia,
    gradientTo,
  };
}

// --- hex / rgb / hsl plumbing ----------------------------------------------

interface Rgb { r: number; g: number; b: number }
interface Hsl { h: number; s: number; l: number }

function hexToRgb(hex: string): Rgb | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = (gn - bn) / d + (gn < bn ? 6 : 0); break;
      case gn: h = (bn - rn) / d + 2; break;
      default: h = (rn - gn) / d + 4;
    }
    h /= 6;
  }
  return { h, s, l };
}

function hslToHex({ h, s, l }: Hsl): string {
  const hue2rgb = (p: number, q: number, t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (n: number) => Math.round(n * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** WCAG relative luminance (0..1) of a #rrggbb, for the readable-text pick. */
function relLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const a = [rgb.r, rgb.g, rgb.b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

function withL(hsl: Hsl, l: number): Hsl {
  return { ...hsl, l: clamp01(l) };
}

function rotateHue(hsl: Hsl, deg: number): Hsl {
  let h = hsl.h + deg / 360;
  h -= Math.floor(h); // wrap into 0..1
  return { ...hsl, h };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
