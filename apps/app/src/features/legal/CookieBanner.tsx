/**
 * CookieBanner — GDPR/CCPA consent surface.
 *
 * Visible on first visit, dismissable. Stores decision in localStorage
 * under a versioned key so a future schema change (adding a category,
 * tightening defaults) re-prompts every user.
 *
 * V1 categories:
 *   - essential       always on (auth tokens, session state)
 *   - analytics       opt-in (Sentry, future usage analytics)
 *
 * The "Manage" button currently only differentiates accept-all vs
 * essentials-only. When we add more categories (advertising, marketing
 * email tracking pixels) the dialog grows here, but the stored shape
 * already supports it via the per-category booleans.
 *
 * IMPORTANT: this is a soft consent UI. Analytics tools that load
 * BEFORE the user clicks Accept will still fire. The current setup is
 * Sentry-only, which we treat as essential-tier observability (errors
 * only, no behavioral analytics, no marketing pixels). When we add
 * tracking that *needs* opt-in (Mixpanel, Segment, etc.), gate their
 * init behind useCookieConsent().
 */
import * as React from "react";
import { Cookie, X } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/navigatr";
import { cn } from "@/lib/utils";

// Bump this version when the consent shape changes (new category, etc.).
// Old localStorage entries become invalid → users get re-prompted.
const CONSENT_VERSION = 1;
const STORAGE_KEY = "navigatr:cookie-consent";

export type CookieCategory = "essential" | "analytics";
export type ConsentRecord = {
  v: number;
  decided_at: string;
  categories: Record<CookieCategory, boolean>;
};

/**
 * Read the persisted consent record, or null if none / outdated.
 * Used by the banner itself + by any caller that needs to gate a
 * non-essential tool's init (useCookieConsent below).
 */
export function loadConsent(): ConsentRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConsentRecord>;
    // Outdated schema → treat as no decision yet.
    if (parsed.v !== CONSENT_VERSION) return null;
    if (!parsed.categories) return null;
    return parsed as ConsentRecord;
  } catch {
    return null;
  }
}

function persistConsent(record: ConsentRecord) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // localStorage disabled (private browsing). Banner will re-show every
    // load; not ideal but not blocking.
  }
}

/**
 * useCookieConsent — read-only hook for gating tool inits.
 * Returns the consent state. Subscribers re-render when the user makes
 * a decision via the banner (window storage event + a same-tab custom event).
 */
export function useCookieConsent(): ConsentRecord | null {
  const [consent, setConsent] = React.useState<ConsentRecord | null>(() => loadConsent());
  React.useEffect(() => {
    const handler = () => setConsent(loadConsent());
    window.addEventListener("storage", handler);
    window.addEventListener("navigatr:cookie-consent", handler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("navigatr:cookie-consent", handler);
    };
  }, []);
  return consent;
}

function dispatchConsentChange() {
  window.dispatchEvent(new Event("navigatr:cookie-consent"));
}

export function CookieBanner() {
  // Don't render until we know whether a decision exists. Avoids the
  // flash-of-banner on a returning user.
  const [visible, setVisible] = React.useState(() => loadConsent() === null);

  React.useEffect(() => {
    if (loadConsent() !== null) setVisible(false);
  }, []);

  if (!visible) return null;

  const decide = (acceptAnalytics: boolean) => {
    const record: ConsentRecord = {
      v: CONSENT_VERSION,
      decided_at: new Date().toISOString(),
      categories: {
        essential: true, // always on; the choice is non-existent
        analytics: acceptAnalytics,
      },
    };
    persistConsent(record);
    dispatchConsentChange();
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookie-banner-title"
      aria-describedby="cookie-banner-body"
      className={cn(
        // Fixed bottom-of-viewport on mobile + desktop. z-50 to sit above
        // toasts but below any modal that the user explicitly opened.
        "fixed inset-x-0 bottom-0 z-40 px-4 pb-4 sm:inset-x-auto sm:right-4 sm:max-w-md",
        // Slide in from below on first render.
        "animate-in slide-in-from-bottom-2 fade-in-0 duration-200",
      )}
    >
      <div className="rounded-radius-lg border border-border-default bg-surface-elevated p-4 shadow-card-hover">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-radius-full bg-brand-primary-10 text-brand-primary"
          >
            <Cookie className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="cookie-banner-title"
              className="text-body-strong text-text-default"
            >
              Cookies
            </h2>
            <p id="cookie-banner-body" className="mt-1 text-caption text-text-muted">
              We use essential cookies to keep you signed in. With your
              consent, we also use analytics cookies to monitor for errors
              and improve the product.{" "}
              <Link to="/privacy" className="text-brand-primary hover:underline">
                Privacy policy
              </Link>
              .
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => decide(true)}
              >
                Accept all
              </Button>
              <Button
                variant="tertiary"
                size="sm"
                onClick={() => decide(false)}
              >
                Essential only
              </Button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => decide(false)}
            aria-label="Dismiss"
            className="text-text-muted hover:text-text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default CookieBanner;
