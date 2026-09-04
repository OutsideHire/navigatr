/**
 * colorShades.test.ts verifies deriveBrandVars: the per-mode brand variable
 * derivation (contrast-aware text, dark-mode lightening, accent gradient).
 */
import { describe, it, expect } from "vitest";
import { deriveBrandVars } from "./colorShades";

// Sum of RGB as a cheap brightness proxy (monotonic for same-hue shades).
function bright(hex: string): number {
  const v = parseInt(hex.replace("#", "").slice(0, 6), 16);
  return ((v >> 16) & 255) + ((v >> 8) & 255) + (v & 255);
}
const HEX = /^#[0-9a-f]{6}$/;

describe("deriveBrandVars", () => {
  it("returns null for a non-#rrggbb input", () => {
    for (const bad of ["", "#abc", "not-a-color", "#ggggggg"]) {
      expect(deriveBrandVars(bad, false)).toBeNull();
      expect(deriveBrandVars(bad, true)).toBeNull();
    }
  });

  it("keeps the accent as the primary in light mode and fills every var", () => {
    const v = deriveBrandVars("#5856eb", false)!;
    expect(v.primary).toBe("#5856eb");
    expect(v.tint10).toBe("#5856eb19");
    for (const k of ["primary", "hover", "pressed", "gradientFrom", "gradientVia", "gradientTo"] as const) {
      expect(v[k]).toMatch(HEX);
    }
    expect(v.foreground).toBe("#ffffff"); // dark indigo -> white button text
  });

  it("picks near-black text on a pale accent (contrast-aware)", () => {
    const v = deriveBrandVars("#ffe680", false)!; // light yellow
    expect(v.foreground).toBe("#16181f");
  });

  it("light mode hover/pressed are darker than the primary", () => {
    const v = deriveBrandVars("#2456e6", false)!;
    expect(bright(v.hover)).toBeLessThan(bright(v.primary));
    expect(bright(v.pressed)).toBeLessThan(bright(v.hover));
  });

  it("dark mode lightens the accent and takes hover/pressed lighter still", () => {
    const v = deriveBrandVars("#2456e6", true)!;
    expect(bright(v.primary)).toBeGreaterThan(bright("#2456e6"));
    expect(bright(v.hover)).toBeGreaterThan(bright(v.primary));
    expect(bright(v.pressed)).toBeGreaterThan(bright(v.hover));
  });

  it("derives a real gradient sweep off the accent hue", () => {
    const v = deriveBrandVars("#0d9488", false)!;
    expect(v.gradientFrom).toBe(v.primary);
    expect(v.gradientVia).not.toBe(v.gradientFrom);
    expect(v.gradientTo).not.toBe(v.gradientVia);
    expect(v.gradientVia).toMatch(HEX);
    expect(v.gradientTo).toMatch(HEX);
  });
});
