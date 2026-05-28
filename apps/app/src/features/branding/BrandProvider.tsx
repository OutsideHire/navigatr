/**
 * BrandProvider — applies the org's white-label theme at runtime.
 *
 * Mount once near the top of the authenticated tree. On every brand
 * change it writes CSS variables onto document.documentElement, where
 * the Tailwind utilities resolve them. Light + dark modes both read
 * the same variables, so the swap works in either theme.
 *
 * Why document.documentElement (not a context + components):
 *   1. Every styled element in the app already reads via Tailwind →
 *      CSS var. Touching <html> changes them all in one write.
 *   2. The provider has zero runtime cost when the org runs default
 *      branding (primary_color = null = no overrides applied).
 *   3. Surviving SSR / hydration is a non-issue because this is a SPA.
 *
 * Reset behavior: when primary_color goes back to null (admin clicks
 * "Reset to defaults"), the provider removes the inline overrides so
 * the design-system tokens from index.css take over again.
 */
import * as React from "react";
import { useBrand } from "./useBrand";
import { deriveShades } from "./colorShades";

const CSS_VARS = [
  "--color-brand-primary",
  "--color-brand-primary-hover",
  "--color-brand-primary-pressed",
  "--color-brand-primary-10",
] as const;

/** Window for document.title update — keeps the tab label in sync with
 *  the org's product_name without forcing a hard reload. */
function setDocumentTitle(productName: string) {
  if (typeof document === "undefined") return;
  document.title = productName;
}

function applyShadeOverrides(primaryColor: string | null) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  // Default branding: strip overrides so index.css tokens win again.
  if (!primaryColor) {
    CSS_VARS.forEach((v) => root.style.removeProperty(v));
    return;
  }

  const shades = deriveShades(primaryColor);
  if (!shades) {
    // Bad hex shouldn't have made it past the RPC's regex, but if it did
    // we'd rather fall back to defaults than crash the theme.
    CSS_VARS.forEach((v) => root.style.removeProperty(v));
    return;
  }

  root.style.setProperty("--color-brand-primary",         shades.primary);
  root.style.setProperty("--color-brand-primary-hover",   shades.hover);
  root.style.setProperty("--color-brand-primary-pressed", shades.pressed);
  root.style.setProperty("--color-brand-primary-10",      shades.tint10);
}

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const brand = useBrand();
  const primaryColor = brand.data?.primaryColor ?? null;
  const productName = brand.data?.productName ?? "navigatr";

  React.useEffect(() => {
    applyShadeOverrides(primaryColor);
    // Cleanup on unmount: revert to defaults so a future un-themed surface
    // (e.g. the marketing site if it ever mounts under the same root)
    // doesn't inherit stale colors.
    return () => applyShadeOverrides(null);
  }, [primaryColor]);

  React.useEffect(() => {
    setDocumentTitle(productName);
  }, [productName]);

  return <>{children}</>;
}
