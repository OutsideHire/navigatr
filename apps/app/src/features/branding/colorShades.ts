/**
 * colorShades.ts — derive hover / pressed / 10%-alpha tints from a primary.
 *
 * The design system has three brand-primary slots: base, hover, pressed,
 * plus a 10%-alpha tint used for selected-row backgrounds. When the org
 * picks a custom primary, we have to derive the other three. Doing it
 * client-side keeps the admin UI snappy (no round-trip to compute shades)
 * and lets the picker preview the full button state set in real time.
 *
 * Strategy: convert hex → HSL, then nudge L (lightness). HSL is the
 * cheapest model for "darker version of same hue." Manipulating in RGB
 * would shift hue when colors get near pure red/green/blue.
 *
 * The exact L deltas (-8 for hover, -15 for pressed) match the visual
 * relationship in the default design-system primaries:
 *   #5856eb (L≈63) → hover ≈ #4f4fe3 (L≈60) → pressed ≈ #4040c7 (L≈52)
 * Not pixel-perfect to the original tokens (those used a 3-color brand
 * scale, not pure HSL), but close enough that no ISO's custom color
 * will look "off" against the same buttons.
 */

export interface BrandShades {
  primary: string;
  hover: string;
  pressed: string;
  /** 10%-alpha version, formatted as #rrggbbaa (matches design tokens). */
  tint10: string;
}

/**
 * Build the full shade set from a single hex primary. Returns null if
 * the input doesn't look like a #rrggbb — caller falls back to design
 * system defaults in that case.
 */
export function deriveShades(hex: string): BrandShades | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const hsl = rgbToHsl(rgb);

  const hover  = hslToHex({ ...hsl, l: clamp01(hsl.l - 0.04) });
  const pressed = hslToHex({ ...hsl, l: clamp01(hsl.l - 0.12) });

  return {
    primary: normaliseHex(hex),
    hover,
    pressed,
    tint10: normaliseHex(hex) + "19", // 0x19 = 25/255 ≈ 10% alpha
  };
}

// --- hex / rgb / hsl plumbing ----------------------------------------------

function normaliseHex(hex: string): string {
  return hex.toLowerCase();
}

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

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
