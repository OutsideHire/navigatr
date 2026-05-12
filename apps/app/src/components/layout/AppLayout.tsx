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
 *   ┌──────┬──────────────────┐
 *   │      │   TopBar (sticky)│
 *   │ Side ├──────────────────┤
 *   │  Nav │                  │
 *   │ 240  │   <main>         │
 *   │ /64  │                  │
 *   │      │                  │
 *   └──────┴──────────────────┘
 *
 * SidebarNav lives next to the content column inside a flex parent.
 * Its `width` transitions smoothly between 240 and 64 px when collapsed.
 *
 * Collapsed state is persisted to localStorage (`navigatr-sidebar-collapsed`)
 * so navigating between routes doesn't reset the user's preference.
 */

import * as React from "react";
import { TopBar, type TopBarUser } from "./TopBar";
import { BottomNav } from "./BottomNav";
import { SidebarNav } from "./SidebarNav";

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
  tenantAppName,
  showSearch = true,
  collapsedOverride,
  onCollapseToggleOverride,
}: AppLayoutProps) {
  const [collapsed, toggle] = useSidebarCollapsed();
  const effectiveCollapsed = collapsedOverride ?? collapsed;
  const effectiveToggle = onCollapseToggleOverride ?? toggle;

  return (
    <div className="flex min-h-dvh bg-surface-canvas text-text-default">
      {/* Sidebar — desktop only, hidden at <md via SidebarNav's own md:flex */}
      <SidebarNav collapsed={effectiveCollapsed} onCollapseToggle={effectiveToggle} />

      {/* Right column — TopBar + main + (mobile) BottomNav */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          user={user}
          tenantLogo={tenantLogo}
          tenantAppName={tenantAppName}
          showSearch={showSearch}
        />

        <main
          // pb-20 on mobile clears the fixed BottomNav (h-16 + safe-area).
          // overflow-x-hidden prevents wide content from spilling out of the
          // narrow column when sidebar is expanded on small desktops.
          className="flex-1 overflow-x-hidden pb-20 md:pb-0"
        >
          {children}
        </main>

        {/* Bottom nav — mobile only, fixed bottom */}
        <BottomNav />
      </div>
    </div>
  );
}

export default AppLayout;
