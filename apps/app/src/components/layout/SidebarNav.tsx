/**
 * navigatr SidebarNav — desktop-only side navigation.
 *
 * Source: Figma `Sidebar nav (desktop)` COMPONENT_SET 58:87, 2 variants:
 *   Collapsed=false  240 × 480 px
 *   Collapsed=true    64 × 480 px
 *
 * Bar specs:
 *   - fill surface/elevated, right edge border/subtle 1 px stroke
 *   - padding 24 / 24 / 24 / 24, gap 24 (between nav-item groups)
 *   - SidebarNavItem 44 px tall, gap 12 (icon + label), padding 12/12, radius 6
 *   - Inactive: text/muted icon + label, body/md
 *   - Active: brand/primary text + icon (Figma binding), plus a 2 px brand-primary
 *     left accent and a brand-primary-10 background tint per the playbook
 *     (those last two aren't in Figma's component yet — flag for reverse-import)
 *
 * Collapse transition: width animates 240 → 64 (~200 ms). Labels fade and
 * collapse to width 0. We avoid CSS `width: auto` transitions; tween the
 * fixed widths so React Router NavLinks stay layout-stable.
 */

import { NavLink } from "react-router-dom";
import { BarChart3, ChevronLeft, ChevronRight, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAIN_TABS, type NavTabSpec } from "./nav-tabs";
import { useProfile } from "@/features/auth/useProfile";

export interface SidebarNavProps {
  collapsed?: boolean;
  onCollapseToggle?: () => void;
  className?: string;
}

function SidebarNavItem({ tab, collapsed }: { tab: NavTabSpec; collapsed: boolean }) {
  return (
    <NavLink
      to={tab.to}
      end={tab.to === "/dashboard"}
      className={({ isActive }) =>
        cn(
          // Figma 58:67/71/75/79/83: 44 tall, gap 12, padding 12, radius 6
          "group relative flex h-11 items-center gap-3 rounded-radius-sm px-3",
          "transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-elevated",
          isActive
            ? "bg-brand-primary-10 text-brand-primary"
            : "text-text-muted hover:bg-surface-sunken hover:text-text-default",
          collapsed && "justify-center px-0",
        )
      }
      aria-label={tab.label}
      title={collapsed ? tab.label : undefined}
    >
      {({ isActive }) => (
        <>
          {/* 2 px brand-primary left accent on active — Figma doesn't have this
              yet but DESIGN.md anti-pattern note says this is the canonical
              active state for sidebar nav items. Reverse-import flag. */}
          {isActive && (
            <span
              aria-hidden
              className="absolute inset-y-1.5 left-0 w-0.5 rounded-radius-full bg-brand-primary"
            />
          )}
          <tab.icon
            className={cn("h-5 w-5 shrink-0", isActive && "stroke-[2.25]")}
            aria-hidden
          />
          {/* Label collapses smoothly. We DON'T `display: none` it because
              that kills the width-transition; we use opacity + width. */}
          <span
            className={cn(
              "overflow-hidden whitespace-nowrap text-body-md transition-[width,opacity] duration-200",
              collapsed ? "w-0 opacity-0" : "w-auto opacity-100",
              isActive ? "font-semibold" : "font-medium",
            )}
          >
            {tab.label}
          </span>
        </>
      )}
    </NavLink>
  );
}

const TEAM_TAB: NavTabSpec = {
  key: "team",
  label: "Team",
  to: "/admin/agents",
  icon: Users,
};

const INSIGHTS_TAB: NavTabSpec = {
  key: "insights",
  label: "Insights",
  to: "/admin/insights",
  icon: BarChart3,
};

export function SidebarNav({ collapsed = false, onCollapseToggle, className }: SidebarNavProps) {
  const profile = useProfile();
  const isManagerOrAdmin =
    profile.data?.role === "manager" || profile.data?.role === "admin";

  return (
    <aside
      aria-label="Primary"
      className={cn(
        // Sticky top-16 = 64 px = TopBar height, so the sidebar sits flush
        // below the TopBar and stays anchored on scroll. Height calc keeps
        // it from spilling below the viewport edge.
        "sticky top-16 hidden h-[calc(100dvh-4rem)] shrink-0 flex-col border-r border-border-subtle bg-surface-elevated md:flex",
        "transition-[width] duration-200",
        collapsed ? "w-16" : "w-60",
        className,
      )}
    >
      {/* Main destinations */}
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {MAIN_TABS.map((tab) => (
          <SidebarNavItem key={tab.key} tab={tab} collapsed={collapsed} />
        ))}

        {isManagerOrAdmin && (
          <>
            <SidebarNavItem tab={TEAM_TAB} collapsed={collapsed} />
            <SidebarNavItem tab={INSIGHTS_TAB} collapsed={collapsed} />
          </>
        )}

        {/* Settings (personal + org) intentionally not in sidebar — lives
            behind the gear icon in the TopBar. This separates work
            surfaces (sidebar) from configuration (gear). */}
      </nav>

      {/* Collapse toggle (bottom) */}
      {onCollapseToggle && (
        <div className="border-t border-border-subtle p-3">
          <button
            type="button"
            onClick={onCollapseToggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "flex h-9 w-full items-center gap-3 rounded-radius-sm px-3 text-caption font-medium text-text-muted",
              "hover:bg-surface-sunken hover:text-text-default",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-elevated",
              collapsed && "justify-center px-0",
            )}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            <span
              className={cn(
                "overflow-hidden whitespace-nowrap transition-[width,opacity] duration-200",
                collapsed ? "w-0 opacity-0" : "w-auto opacity-100",
              )}
            >
              Collapse
            </span>
          </button>
        </div>
      )}
    </aside>
  );
}

export default SidebarNav;
