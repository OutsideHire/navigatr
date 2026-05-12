/**
 * Visual catalog for the navigation shell — TopBar + BottomNav + SidebarNav
 * composed through AppLayout, with a mock user.
 *
 * Compare against Figma:
 *   Top bar (mobile)     57:2
 *   Top bar (desktop)    57:11
 *   Bottom nav (mobile)  373:132
 *   Sidebar nav (desktop) 58:87
 */

import { useState } from "react";
import { NavLink } from "react-router-dom";
import { ChevronDown, ChevronRight, Activity, Users, TrendingUp, DollarSign } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import type { TopBarUser } from "@/components/layout/TopBar";
import { Button, Card, KpiCard } from "@/components/navigatr";

const MOCK_USER: TopBarUser = {
  fullName: "Ryan Meo",
  email: "ryan@navigatr.app",
  avatarUrl: undefined, // falls back to initials "RM"
};

function MockContent() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <header>
        <p className="text-eyebrow text-text-subtle">Component preview · Layout</p>
        <h1 className="mt-1 text-heading-xl text-text-default">Navigation shell</h1>
        <p className="mt-2 max-w-3xl text-body-md text-text-muted">
          TopBar + SidebarNav (desktop) + BottomNav (mobile) composed via AppLayout. The mock
          user "Ryan Meo" is signed in — click the avatar (top-right) to see Profile / Settings /
          theme cycle / Sign out. Resize the browser to ≤ 768 px to swap into the mobile shell
          with the BottomNav fixed at the bottom.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard eyebrow="ACTIVE LEADS" value="247" icon={Users} accent="teal"
          trend={{ direction: "up", label: "+8 this week", isPositive: true }} />
        <KpiCard eyebrow="PIPELINE" value="$1.2M" icon={DollarSign} accent="violet"
          trend={{ direction: "up", label: "+12.4%", isPositive: true }} />
        <KpiCard eyebrow="WIN RATE" value="34%" icon={TrendingUp} accent="orange"
          trend={{ direction: "down", label: "−2.1%", isPositive: false }} />
        <KpiCard eyebrow="ACTIVITIES TO WIN" value="412" icon={Activity} gradient />
      </div>

      <Card padding="lg" shadow="sm">
        <p className="text-eyebrow text-text-subtle">Try the navigation</p>
        <h2 className="mt-1 text-heading-md text-text-default">Click through all 5 tabs.</h2>
        <p className="mt-2 text-body-md text-text-muted">
          The active tab gets brand-primary text + a 2 px brand-primary left accent on desktop, or
          a brand-primary fill on mobile. Hover any inactive tab — surface/sunken bg, text/default
          on hover.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {(["/dashboard", "/pipeline", "/activities", "/partners", "/path", "/settings"] as const).map((p) => (
            <NavLink
              key={p}
              to={p}
              className={({ isActive }) =>
                `rounded-radius-sm px-3 py-1.5 text-caption font-medium ${
                  isActive
                    ? "bg-brand-primary text-brand-primary-foreground"
                    : "bg-surface-sunken text-text-default hover:bg-surface-elevated"
                }`
              }
            >
              {p}
            </NavLink>
          ))}
        </div>
      </Card>
    </div>
  );
}

export function LayoutStories() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    // No inner router — would conflict with the outer BrowserRouter and
    // throw at runtime. Nav links inside the layout (SidebarNav, BottomNav)
    // navigate to their real routes (/dashboard etc), which is the best
    // demo anyway: you see the layout shell actually react to route changes.
    <div className="relative">
      <AppLayout
        user={MOCK_USER}
        collapsedOverride={collapsed}
        onCollapseToggleOverride={() => setCollapsed((v) => !v)}
      >
        <MockContent />
      </AppLayout>

      {/* Floating control to toggle the desktop sidebar — sits on top of
          the layout for easy verification. Hidden on mobile. */}
      <div className="fixed bottom-6 right-6 z-50 hidden md:block">
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={collapsed ? ChevronRight : ChevronDown}
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? "Expand sidebar" : "Collapse sidebar"}
        </Button>
      </div>
    </div>
  );
}
