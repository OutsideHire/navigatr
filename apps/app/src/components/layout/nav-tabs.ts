/**
 * Single source of truth for the 5 main navigation destinations (+ Settings).
 *
 * Lucide icon choices are taken verbatim from the Figma `Icon · Lucide`
 * instances inside the Sidebar nav (58:30) per-item bindings:
 *
 *   Dashboard  → home          (NOT layout-dashboard)
 *   Pipeline   → trending-up   (NOT git-branch)
 *   Activities → check         (NOT check-circle)
 *   Partners   → users         (NOT handshake)
 *   Path       → compass
 *   Settings   → sliders       (NOT the settings gear)
 */

import { Check, Compass, Home, Sliders, TrendingUp, Users, type LucideIcon } from "lucide-react";

export type NavTabKey =
  | "dashboard"
  | "pipeline"
  | "activities"
  | "partners"
  | "path";

export interface NavTabSpec {
  key: NavTabKey | "settings" | "team" | "insights";
  label: string;
  to: string;
  icon: LucideIcon;
}

export const MAIN_TABS: NavTabSpec[] = [
  { key: "dashboard",  label: "Dashboard",  to: "/dashboard",  icon: Home },
  { key: "pipeline",   label: "Pipeline",   to: "/pipeline",   icon: TrendingUp },
  { key: "activities", label: "Activities", to: "/activities", icon: Check },
  { key: "partners",   label: "Partners",   to: "/partners",   icon: Users },
  { key: "path",       label: "Path",       to: "/path",       icon: Compass },
];

export const SETTINGS_TAB: NavTabSpec = {
  key: "settings",
  label: "Settings",
  to: "/settings",
  icon: Sliders,
};
