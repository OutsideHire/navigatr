/**
 * BrandProvider — applies the org's white-label theme at runtime.
 *
 * Mount once near the top of the authenticated tree. On every brand change
 * (or light/dark toggle) it writes CSS variables onto document.documentElement,
 * where the Tailwind utilities resolve them. The variables are derived per mode
 * so a custom accent looks finished in both light and dark: readable button
 * text, an accent-matched gradient, and a dark-mode-lightened primary.
 *
 * Why document.documentElement (not a context + components):
 *   1. Every styled element in the app already reads via Tailwind -> CSS var.
 *      Touching <html> changes them all in one write.
 *   2. Zero runtime cost when the org runs default branding (primary null).
 *
 * Reset: when primary_color goes back to null (admin "Reset to defaults"),
 * the overrides are removed so the index.css tokens take over again.
 */
import * as React from "react";
import { useTheme } from "@/stores/theme";
import { useBrand } from "./useBrand";
import { deriveBrandVars } from "./colorShades";

const CSS_VARS = [
  "--color-brand-primary",
  "--color-brand-primary-hover",
  "--color-brand-primary-pressed",
  "--color-brand-primary-foreground",
  "--color-brand-primary-10",
  "--color-brand-gradient-from",
  "--color-brand-gradient-via",
  "--color-brand-gradient-to",
] as const;

/** Window for document.title update. Keeps the tab label in sync with the
 *  org's product_name without forcing a hard reload. */
function setDocumentTitle(productName: string) {
  if (typeof document === "undefined") return;
  document.title = productName;
}

function applyOverrides(primaryColor: string | null, isDark: boolean) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  // Default branding (or a bad hex the RPC somehow let through): strip
  // overrides so index.css tokens win again.
  const vars = primaryColor ? deriveBrandVars(primaryColor, isDark) : null;
  if (!vars) {
    CSS_VARS.forEach((v) => root.style.removeProperty(v));
    return;
  }

  root.style.setProperty("--color-brand-primary", vars.primary);
  root.style.setProperty("--color-brand-primary-hover", vars.hover);
  root.style.setProperty("--color-brand-primary-pressed", vars.pressed);
  root.style.setProperty("--color-brand-primary-foreground", vars.foreground);
  root.style.setProperty("--color-brand-primary-10", vars.tint10);
  root.style.setProperty("--color-brand-gradient-from", vars.gradientFrom);
  root.style.setProperty("--color-brand-gradient-via", vars.gradientVia);
  root.style.setProperty("--color-brand-gradient-to", vars.gradientTo);
}

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const brand = useBrand();
  const primaryColor = brand.data?.primaryColor ?? null;
  const productName = brand.data?.productName ?? "navigatr";
  const isDark = useTheme((s) => s.resolvedTheme) === "dark";

  React.useEffect(() => {
    applyOverrides(primaryColor, isDark);
    // Cleanup on unmount: revert to defaults so a future un-themed surface
    // doesn't inherit stale colors.
    return () => applyOverrides(null, isDark);
  }, [primaryColor, isDark]);

  React.useEffect(() => {
    setDocumentTitle(productName);
  }, [productName]);

  return <>{children}</>;
}
