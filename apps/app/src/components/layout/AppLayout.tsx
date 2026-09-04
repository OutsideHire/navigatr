/**
 * navigatr AppLayout — composes TopBar + nav + main content.
 *
 * Mobile (default):
 *   ┌─────────────────────────┐
 *   │   TopBar (sticky)       │   h-14 + safe-area-top
 *   ├─────────────────────────┤
 *   │                         │
 *   │   <main>{children}      │   flex-1, scrollable
 *   │                         │   pb-20 to clear BottomNav
 *   ├─────────────────────────┤
 *   │   BottomNav (fixed)     │   h-16 + safe-area-bottom
 *   └─────────────────────────┘
 *
 * Desktop (md+):
 *   ┌──────────────────────────┐
 *   │   TopBar (full-width)    │   sticky top-0, h-16
 *   ├──────┬───────────────────┤
 *   │      │                   │
 *   │ Side │   <main>          │
 *   │ Nav  │                   │   sidebar sticky below TopBar
 *   │ 240  │                   │
 *   │ /64  │                   │
 *   └──────┴───────────────────┘
 *
 * TopBar spans the full viewport width and sits ABOVE the sidebar — the
 * logo sits at the true top-left of the page (x=0), matching every
 * modern SaaS app layout and Figma 148:464 where the desktop TopBar is
 * authored as a 1280-wide element. SidebarNav becomes a row below the
 * TopBar, sticky just under it.
 *
 * Collapsed state is persisted to localStorage (`navigatr-sidebar-collapsed`)
 * so navigating between routes doesn't reset the user's preference.
 */

import * as React from "react";
import { TopBar, type TopBarUser } from "./TopBar";
import { BottomNav } from "./BottomNav";
import { SidebarNav } from "./SidebarNav";
import { useBrand } from "@/features/branding/useBrand";
import { IntercomBoot } from "@/features/support/IntercomBoot";

const STORAGE_KEY = "navigatr-sidebar-collapsed";

function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return window.localStorage.getItem(STORAGE_KEY) === "true"; }
    catch { return false; }
  });
  const toggle = React.useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try { window.localStorage.setItem(STORAGE_KEY, String(next)); } catch {}
      return next;
    });
  }, []);
  return [collapsed, toggle];
}

export interface AppLayoutProps {
  /** Page content rendered in the main column. */
  children: React.ReactNode;
  /** Signed-in user (forwarded to TopBar). */
  user?: TopBarUser | null;
  /** White-label overrides (forwarded to TopBar). */
  tenantLogo?: string;
  tenantDarkLogo?: string;
  tenantAppName?: string;
  /** Show the desktop search input. Defaults to true. */
  showSearch?: boolean;
  /** Allow overriding the persisted collapsed state — useful for preview/demo. */
  collapsedOverride?: boolean;
  onCollapseToggleOverride?: () => void;
}

export function AppLayout({
  children,
  user,
  tenantLogo,
  tenantDarkLogo,
  tenantAppName,
  showSearch = true,
  collapsedOverride,
  onCollapseToggleOverride,
}: AppLayoutProps) {
  const [collapsed, toggle] = useSidebarCollapsed();
  const effectiveCollapsed = collapsedOverride ?? collapsed;
  const effectiveToggle = onCollapseToggleOverride ?? toggle;

  // useBrand returns undefined.data when no user/org (component preview
  // routes, sign-in screens that happen to mount this layout). Defaults
  // to the navigatr brand in that case. Explicit props passed by the
  // caller win over the brand query — useful for storybook fixtures.
  const brand = useBrand();
  const resolvedLogo = tenantLogo ?? brand.data?.logoUrl ?? undefined;
  const resolvedDarkLogo = tenantDarkLogo ?? brand.data?.darkLogoUrl ?? undefined;
  const resolvedAppName = tenantAppName ?? brand.data?.productName ?? "navigatr";

  return (
    <div className="flex min-h-dvh flex-col bg-surface-canvas text-text-default">
      {/* Intercom Messenger boot. Renders nothing; boots the messenger for
          signed-in users when VITE_INTERCOM_APP_ID is set, and is inert
          (ship-dark) otherwise. Lives here so it only runs in the authed
          shell (AppLayout mounts behind ProtectedRoute). */}
      <IntercomBoot />

      {/* TopBar — full viewport width, sticky top. The logo lives here at
          the true top-left (x=0) of the page on every breakpoint. */}
      <TopBar
        user={user}
        tenantLogo={resolvedLogo}
        tenantDarkLogo={resolvedDarkLogo}
        tenantAppName={resolvedAppName}
        showSearch={showSearch}
      />

      {/* Body row — sidebar (desktop only) + main content side-by-side */}
      <div className="flex min-h-0 flex-1">
        {/* Sidebar — desktop only via SidebarNav's own md:flex. Stays sticky
            just under the TopBar at top-16 = 64 px (TopBar height). */}
        <SidebarNav collapsed={effectiveCollapsed} onCollapseToggle={effectiveToggle} />

        <main
          // pb-20 on mobile clears the fixed BottomNav (h-16 + safe-area).
          // overflow-x-hidden prevents wide content from spilling out of the
          // narrow column when sidebar is expanded on small desktops.
          className="min-w-0 flex-1 overflow-x-hidden pb-20 md:pb-0"
        >
          {children}
          {/* Footer. The "Map data © OpenStreetMap" credit is REQUIRED (the map
              renders OpenStreetMap data under ODbL) and shows on EVERY breakpoint.
              "Powered by navigatr" is ALWAYS shown (desktop-only, since mobile has
              the BottomNav). A white-label org cannot hide the navigatr credit.
              Discreet, low-contrast so it doesn't compete with page content. */}
          <footer className="mt-12 border-t border-border-subtle px-6 py-4 text-caption text-text-subtle">
            <span className="hidden md:inline">
              Powered by{" "}
              <a
                href="https://navigatr.app"
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-muted underline-offset-4 hover:text-text-default hover:underline"
              >
                navigatr
              </a>
              <span className="px-2" aria-hidden>·</span>
            </span>
            Map data ©{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-muted underline-offset-4 hover:text-text-default hover:underline"
            >
              OpenStreetMap
            </a>
          </footer>
        </main>
      </div>

      {/* Bottom nav — mobile only, fixed bottom */}
      <BottomNav />
    </div>
  );
}

export default AppLayout;
