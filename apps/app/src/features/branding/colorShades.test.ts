/**
 * colorShades.test.ts — verifies the hex→HSL→hex shade derivation.
 *
 * We don't pin the exact output of every shade to a pixel value (HSL
 * round-trip drift accumulates by 1-2 in the lowest byte), so the
 * assertions check directional + structural properties:
 *
 *   - hover is darker than primary
 *   - pressed is darker than hover
 *   - tint10 is the primary with an alpha suffix
 *   - invalid input returns null (no crash, no silent default)
 */
import { describe, it, expect } from "vitest";
import { deriveShades } from "./colorShades";

function hexLightness(hex: string): number {
  const v = parseInt(hex.slice(1, 7), 16);
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
}

describe("deriveShades", () => {
  it("returns null for malformed hex", () => {
    expect(deriveShades("")).toBeNull();
    expect(deriveShades("#abc")).toBeNull();
    expect(deriveShades("not-a-color")).toBeNull();
    expect(deriveShades("#ggggggg")).toBeNull();
  });

  it("returns shades for a valid hex (lowercased)", () => {
    const shades = deriveShades("#2456E6");
    expect(shades).not.toBeNull();
    expect(shades!.primary).toBe("#2456e6");
  });

  it("hover is darker than primary; pressed is darker than hover", () => {
    const shades = deriveShades("#5856eb")!;
    const lPrimary = hexLightness(shades.primary);
    const lHover   = hexLightness(shades.hover);
    const lPressed = hexLightness(shades.pressed);
    expect(lHover).toBeLessThan(lPrimary);
    expect(lPressed).toBeLessThan(lHover);
  });

  it("tint10 is primary with #19 alpha suffix (≈10%)", () => {
    const shades = deriveShades("#2456E6")!;
    expect(shades.tint10).toBe("#2456e619");
  });

  it("handles dark inputs (pressed shade clamps at 0 lightness, no crash)", () => {
    // Very dark input — pressed would push L below 0; the helper clamps.
    const shades = deriveShades("#0a0a0a");
    expect(shades).not.toBeNull();
    expect(shades!.pressed.startsWith("#")).toBe(true);
    expect(shades!.pressed).toHaveLength(7);
  });

  it("handles light inputs (white)", () => {
    const shades = deriveShades("#ffffff")!;
    // Hover/pressed should be darker than #ffffff.
    expect(hexLightness(shades.hover)).toBeLessThan(255);
    expect(hexLightness(shades.pressed)).toBeLessThan(hexLightness(shades.hover));
  });

  it("preserves hue (R-dominant input stays R-dominant)", () => {
    const shades = deriveShades("#ff3344")!;
    const parseRgb = (hex: string) => ({
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
    });
    const rgb = parseRgb(shades.hover);
    expect(rgb.r).toBeGreaterThan(rgb.g);
    expect(rgb.r).toBeGreaterThan(rgb.b);
  });
});
