/**
 * SettingsHubPage — the unified settings surface.
 *
 * Two layouts driven by viewport width:
 *   - >= md (768px): left-rail tabs + content panel. WAI-ARIA Tabs pattern.
 *   - < md:          settings index → drill-in. iOS Settings app pattern.
 *
 * URL is the source of truth for the active tab. Desktop uses ?tab=<id>
 * query param; mobile uses /settings/<id> path segments. Both routes
 * land on this same component; layout decision is viewport-based.
 *
 * Role gating: visibleTabs() filters per current user role. A rep
 * navigating directly to /settings?tab=branding gets transparently
 * redirected to ?tab=personal (no error, no toast — the tab is just
 * not in their list).
 */
import * as React from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useProfile } from "@/features/auth/useProfile";
import {
  SETTINGS_TABS,
  GROUP_LABEL,
  visibleTabs,
  resolveTab,
  type SettingsTabId,
  type SettingsTabDef,
} from "./tabs";
import { PersonalTab } from "./tabs/PersonalTab";
import { OrganizationTab } from "./tabs/OrganizationTab";
import { IntegrationsTab } from "./tabs/IntegrationsTab";
import { BrandingTab } from "./tabs/BrandingTab";
import { ProfessionTab } from "./tabs/ProfessionTab";
import { DangerZoneTab } from "./tabs/DangerZoneTab";

/** Map tab id → content component. */
const TAB_COMPONENTS: Record<SettingsTabId, React.ComponentType> = {
  personal:     PersonalTab,
  organization: OrganizationTab,
  integrations: IntegrationsTab,
  branding:     BrandingTab,
  profession:   ProfessionTab,
  danger:       DangerZoneTab,
};

/**
 * useIsDesktop — single boolean for layout switching.
 * Uses matchMedia rather than window.innerWidth to get a live subscription.
 * Defaults to `true` during SSR-safety guard so first render matches the
 * desktop layout's structure (cheap on mobile too, gets corrected on mount).
 */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = React.useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(min-width: 768px)").matches;
  });
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 768px)");
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isDesktop;
}

export function SettingsHubPage() {
  const navigate = useNavigate();
  const profile = useProfile();
  const role = profile.data?.role;
  const isDesktop = useIsDesktop();

  // Two URL shapes resolve to this component:
  //   Desktop: /settings?tab=<id>
  //   Mobile:  /settings/<id>
  // useSearchParams handles the query string; useParams the path segment.
  // Whichever is present wins; both undefined → default to "personal".
  const [searchParams, setSearchParams] = useSearchParams();
  const { tabId: pathTabId } = useParams<{ tabId?: string }>();
  const requestedTab = pathTabId ?? searchParams.get("tab");

  const { id: activeTab, redirected } = resolveTab(requestedTab, role);

  // If the user requested an invalid/forbidden tab, replace the URL with
  // the resolved one (no junk in history). Use replace, not push, so the
  // back button still works as expected.
  React.useEffect(() => {
    if (!redirected) return;
    if (pathTabId) {
      // Mobile path: replace with the canonical path.
      navigate(`/settings/${activeTab}`, { replace: true });
    } else {
      // Desktop query: replace with the canonical ?tab=<id>.
      setSearchParams({ tab: activeTab }, { replace: true });
    }
  }, [redirected, activeTab, pathTabId, navigate, setSearchParams]);

  const tabs = visibleTabs(role);
  const activeDef = tabs.find((t) => t.id === activeTab) ?? tabs[0];
  const ActiveContent = TAB_COMPONENTS[activeDef.id];

  // ---- Mobile: index → drill-in --------------------------------------------
  // When NO tab id is in the URL on mobile, show the index. Otherwise show
  // the active tab's content full-bleed with a back affordance.
  if (!isDesktop) {
    if (!pathTabId) {
      return <MobileIndex tabs={tabs} />;
    }
    return (
      <MobileDetail
        tab={activeDef}
        onBack={() => navigate("/settings", { replace: true })}
        Content={ActiveContent}
      />
    );
  }

  // ---- Desktop: left rail + content panel ----------------------------------
  // Layout per the design critique: tab rail flush against the AppLayout
  // sidebar (no left padding outside the rail), content panel takes the
  // remaining width capped at 920px. Kills the previous "dead column" on
  // the left that pushed the content panel ~400px right.
  return (
    <div className="flex w-full">
      <DesktopTabList
        tabs={tabs}
        activeId={activeDef.id}
        onSelect={(id) => setSearchParams({ tab: id })}
      />
      <div className="min-w-0 flex-1 px-6 py-10 lg:px-12">
        <div className="max-w-[920px]">
          <ActiveContent />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Desktop left rail
// ---------------------------------------------------------------------------
function DesktopTabList({
  tabs,
  activeId,
  onSelect,
}: {
  tabs: SettingsTabDef[];
  activeId: SettingsTabId;
  onSelect: (id: SettingsTabId) => void;
}) {
  // WAI-ARIA Tabs pattern: tablist + tabs + arrow-key navigation between them.
  const tabRefs = React.useRef<Map<SettingsTabId, HTMLButtonElement | null>>(new Map());

  const handleKeyDown = (e: React.KeyboardEvent, currentId: SettingsTabId) => {
    const idx = tabs.findIndex((t) => t.id === currentId);
    if (idx < 0) return;
    let nextIdx: number | null = null;
    if (e.key === "ArrowDown") nextIdx = (idx + 1) % tabs.length;
    if (e.key === "ArrowUp")   nextIdx = (idx - 1 + tabs.length) % tabs.length;
    if (e.key === "Home")      nextIdx = 0;
    if (e.key === "End")       nextIdx = tabs.length - 1;
    if (nextIdx === null) return;
    e.preventDefault();
    const nextId = tabs[nextIdx].id;
    onSelect(nextId);
    tabRefs.current.get(nextId)?.focus();
  };

  return (
    <nav
      role="tablist"
      aria-orientation="vertical"
      aria-label="Settings sections"
      // Flush against AppLayout sidebar (no left margin), 180px wide.
      // Right border separates rail from content panel.
      className="w-[180px] shrink-0 border-r border-border-subtle px-2 py-6"
    >
      {tabs.map((tab, idx) => {
        const isActive = tab.id === activeId;
        // Render the group label whenever this tab's group differs from
        // the previous one (or on the first tab).
        const showGroupLabel = idx === 0 || tabs[idx - 1].group !== tab.group;
        return (
          <React.Fragment key={tab.id}>
            {showGroupLabel && (
              <div
                className={cn(
                  "px-3 text-eyebrow text-text-subtle",
                  // First label sits tight to the rail top; subsequent
                  // labels get extra breathing room above to visually
                  // separate from the previous group.
                  idx === 0 ? "pb-1.5" : "pb-1.5 pt-4",
                )}
                aria-hidden
              >
                {GROUP_LABEL[tab.group]}
              </div>
            )}
            <button
              ref={(el) => { tabRefs.current.set(tab.id, el); }}
              role="tab"
              aria-selected={isActive}
              aria-current={isActive ? "page" : undefined}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onSelect(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, tab.id)}
              className={cn(
                "block w-full rounded-radius-sm px-3 py-2 text-left text-body-md",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
                isActive
                  ? "bg-brand-primary-10 font-medium text-text-default"
                  : "text-text-muted hover:bg-surface-sunken hover:text-text-default",
              )}
            >
              {tab.label}
            </button>
          </React.Fragment>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Mobile index page
// ---------------------------------------------------------------------------
function MobileIndex({ tabs }: { tabs: SettingsTabDef[] }) {
  const navigate = useNavigate();
  return (
    <div className="w-full px-4 py-6">
      <h1 className="mb-4 text-heading-lg">Settings</h1>
      <ul className="flex flex-col gap-px overflow-hidden rounded-radius-md border border-border-default bg-surface-default">
        {tabs.map((tab, idx) => {
          const showGroupLabel = idx === 0 || tabs[idx - 1].group !== tab.group;
          return (
            <React.Fragment key={tab.id}>
              {showGroupLabel && (
                <li className="bg-surface-canvas px-4 py-2 text-eyebrow text-text-subtle" aria-hidden>
                  {GROUP_LABEL[tab.group]}
                </li>
              )}
              <li>
                <button
                  type="button"
                  onClick={() => navigate(`/settings/${tab.id}`)}
                  className={cn(
                    "flex w-full items-center justify-between px-4 py-3 text-left text-body-md text-text-default",
                    "hover:bg-surface-sunken",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
                  )}
                >
                  <span>{tab.label}</span>
                  <ChevronRight className="h-4 w-4 text-text-subtle" aria-hidden />
                </button>
              </li>
            </React.Fragment>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mobile detail page
// ---------------------------------------------------------------------------
function MobileDetail({
  tab,
  onBack,
  Content,
}: {
  tab: SettingsTabDef;
  onBack: () => void;
  Content: React.ComponentType;
}) {
  return (
    <div className="w-full px-4 py-4">
      <button
        type="button"
        onClick={onBack}
        className={cn(
          "mb-3 inline-flex items-center gap-1 text-body-md text-text-muted",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
        )}
        aria-label="Back to settings"
      >
        ← Settings
      </button>
      <h1 className="mb-4 text-heading-lg">{tab.label}</h1>
      <Content />
    </div>
  );
}

export default SettingsHubPage;
// Re-export for tests
export { SETTINGS_TABS };
