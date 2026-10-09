/**
 * PortalShell: the partner-facing frame. Shows the ISO's logo and name, never
 * the navigatr mark (AuthShell hardcodes it, so the portal has its own shell).
 * Mobile-first: one narrow column that reads well at 360px.
 */
import * as React from "react";
import { Logo } from "@/components/layout/Logo";
import type { PortalBrand } from "../lib/portalApi";

export function PortalShell({ brand, children }: { brand: PortalBrand; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface-canvas">
      <header className="flex h-14 items-center border-b border-border-subtle bg-surface-default px-4">
        {brand.logoUrl ? (
          <Logo
            size="sm"
            wordmark={brand.orgName}
            logoSrc={brand.logoUrl}
            logoSrcDark={brand.darkLogoUrl ?? undefined}
          />
        ) : (
          <span className="truncate text-heading-sm text-text-default">{brand.orgName}</span>
        )}
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-8">{children}</main>
    </div>
  );
}
