/**
 * navigatr BottomNav — mobile-only bottom tab bar.
 *
 * Source: Figma `Bottom nav (mobile)` 373:132 (360 × 64). Each tab is a
 * variant of BottomNavTab COMPONENT_SET 57:29 with State = active|inactive.
 *
 * Layout:
 *   - 5 equal-width tabs, each a NavLink (React Router)
 *   - Bar: surface/default fill, border/subtle 1 px top stroke
 *   - Fixed bottom, padded by `env(safe-area-inset-bottom)` for iOS notch
 *   - Tap target: full tab height (≥ 64 px) — comfortably above the 44 px HIG min
 *
 * State:
 *   - Active: brand/primary icon + label, body-md font-medium
 *   - Inactive: text/muted icon + label, body-md font-normal
 *
 * The Lucide icons used here are imported from `nav-tabs.ts` which mirrors
 * the Figma component bindings verbatim — see that file for the mapping.
 */

import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useNavTabs } from "./useNavTabs";

export interface BottomNavProps {
  className?: string;
}

export function BottomNav({ className }: BottomNavProps) {
  // Profession-aware labels (Pipeline → Book for treasury).
  const mainTabs = useNavTabs();
  return (
    <nav
      aria-label="Primary"
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 border-t border-border-subtle bg-surface-default",
        "supports-[backdrop-filter]:bg-surface-default/95 supports-[backdrop-filter]:backdrop-blur",
        // Hide on desktop — SidebarNav takes over at md+
        "md:hidden",
        // Safe-area padding for iOS home indicator
        "pb-[env(safe-area-inset-bottom)]",
        className,
      )}
    >
      <ul className="grid h-16 grid-cols-5">
        {mainTabs.map((tab) => (
          <li key={tab.key}>
            <NavLink
              to={tab.to}
              end={tab.to === "/dashboard"}
              className={({ isActive }) =>
                cn(
                  "flex h-full flex-col items-center justify-center gap-0.5",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-primary",
                  "transition-colors",
                  isActive
                    ? "text-brand-primary"
                    : "text-text-muted hover:text-text-default",
                )
              }
              aria-label={tab.label}
            >
              {({ isActive }) => (
                <>
                  <tab.icon
                    className={cn(
                      "h-5 w-5",
                      isActive && "stroke-[2.25]",
                    )}
                    aria-hidden
                  />
                  <span
                    className={cn(
                      "text-[11px] leading-none",
                      isActive ? "font-semibold" : "font-medium",
                    )}
                  >
                    {tab.label}
                  </span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default BottomNav;
