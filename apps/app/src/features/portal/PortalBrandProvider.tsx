/**
 * PortalBrandProvider: themes the partner portal with the tenant's color and
 * name before anyone signs in (spec 5.4).
 *
 * The app's BrandProvider reads the signed-in org and takes no brand prop, so
 * the portal sets the same CSS variables from the brand the portal_api returned,
 * reusing deriveBrandVars so a tenant color looks the same in both places. On
 * unmount it removes the overrides and restores the tab title.
 */
import * as React from "react";
import { useTheme } from "@/stores/theme";
import { deriveBrandVars } from "@/features/branding/colorShades";
import type { PortalBrand } from "./lib/portalApi";

export const PORTAL_BRAND_VARS = [
  "--color-brand-primary",
  "--color-brand-primary-hover",
  "--color-brand-primary-pressed",
  "--color-brand-primary-foreground",
  "--color-brand-primary-10",
  "--color-brand-gradient-from",
  "--color-brand-gradient-via",
  "--color-brand-gradient-to",
] as const;

export function applyPortalBrandVars(primaryColor: string | null, isDark: boolean): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const vars = primaryColor ? deriveBrandVars(primaryColor, isDark) : null;
  if (!vars) {
    PORTAL_BRAND_VARS.forEach((name) => root.style.removeProperty(name));
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

export function PortalBrandProvider({ brand, children }: { brand: PortalBrand; children: React.ReactNode }) {
  const isDark = useTheme((s) => s.resolvedTheme) === "dark";

  React.useEffect(() => {
    applyPortalBrandVars(brand.primaryColor, isDark);
    return () => applyPortalBrandVars(null, isDark);
  }, [brand.primaryColor, isDark]);

  React.useEffect(() => {
    const previous = document.title;
    document.title = brand.orgName;
    return () => {
      document.title = previous;
    };
  }, [brand.orgName]);

  return <>{children}</>;
}
