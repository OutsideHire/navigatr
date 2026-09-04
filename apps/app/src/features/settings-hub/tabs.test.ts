/**
 * tabs.test.ts — pure-function tests for visibleTabs + resolveTab.
 *
 * These two functions are load-bearing for role gating + URL handling.
 * They're pure (no React, no router) so test directly without setup.
 */
import { describe, it, expect } from "vitest";
import { visibleTabs, resolveTab, SETTINGS_TABS } from "./tabs";

describe("visibleTabs", () => {
  it("returns only rep+everyone tabs for a rep", () => {
    const result = visibleTabs("rep");
    expect(result.map((t) => t.id)).toEqual(["personal", "organization", "integrations"]);
  });

  it("returns rep+manager tabs for a manager (no branding, no danger zone)", () => {
    // Branding is admin-only, so a manager sees the workspace's profession tab
    // but not branding.
    const result = visibleTabs("manager");
    expect(result.map((t) => t.id)).toEqual([
      "personal",
      "organization",
      "integrations",
      "profession",
    ]);
  });

  it("returns every tab for an admin", () => {
    const result = visibleTabs("admin");
    expect(result.map((t) => t.id)).toEqual([
      "personal",
      "organization",
      "integrations",
      "branding",
      "profession",
      "danger",
    ]);
  });

  it("defaults to rep-visible tabs when role is undefined (pre-load state)", () => {
    const result = visibleTabs(undefined);
    expect(result.map((t) => t.id)).toEqual(["personal", "organization", "integrations"]);
  });

  it("preserves the canonical tab order", () => {
    // Whatever order SETTINGS_TABS declares is what the rail renders. Lock
    // that in so a future "alphabetize the array" doesn't quietly reshuffle
    // the UI.
    expect(SETTINGS_TABS[0].id).toBe("personal");
    expect(SETTINGS_TABS[SETTINGS_TABS.length - 1].id).toBe("danger");
  });
});

describe("resolveTab", () => {
  it("returns the requested tab when role-permitted", () => {
    // Branding is admin-only; an admin requesting it gets it with no redirect.
    const out = resolveTab("branding", "admin");
    expect(out).toEqual({ id: "branding", redirected: false });
  });

  it("redirects a manager away from the admin-only branding tab", () => {
    const out = resolveTab("branding", "manager");
    expect(out).toEqual({ id: "personal", redirected: true });
  });

  it("redirects to personal when tab id is unknown", () => {
    const out = resolveTab("definitely-not-a-tab", "admin");
    expect(out).toEqual({ id: "personal", redirected: true });
  });

  it("redirects to personal when the tab exists but role can't access", () => {
    // Rep trying to access branding directly → silent redirect.
    const out = resolveTab("branding", "rep");
    expect(out).toEqual({ id: "personal", redirected: true });
  });

  it("redirects manager away from admin-only danger zone", () => {
    const out = resolveTab("danger", "manager");
    expect(out).toEqual({ id: "personal", redirected: true });
  });

  it("does NOT mark redirect when no tab was requested", () => {
    // Bare /settings with no ?tab param: not a redirect, just defaulting.
    // This matters because the redirect flag controls history.replaceState.
    const out = resolveTab(null, "admin");
    expect(out).toEqual({ id: "personal", redirected: false });
  });

  it("does NOT mark redirect when the requested tab is 'personal'", () => {
    const out = resolveTab("personal", "rep");
    expect(out).toEqual({ id: "personal", redirected: false });
  });

  it("handles undefined raw input as no-redirect default", () => {
    const out = resolveTab(undefined, "admin");
    expect(out).toEqual({ id: "personal", redirected: false });
  });

  it("handles empty string as no-redirect default", () => {
    // An empty string param shouldn't trigger a redirect either; just
    // resolve to the default tab quietly.
    const out = resolveTab("", "admin");
    expect(out).toEqual({ id: "personal", redirected: false });
  });
});
