/**
 * RouteErrorBoundary — catches render errors below the AppLayout chrome.
 *
 * Placement: inside `<AppLayout>`, wrapping the route's content. That way
 * a render crash in any page collapses ONLY the main pane and shows a
 * friendly fallback — the TopBar, sidebar nav, and bottom nav stay
 * functional, so the user can navigate out instead of staring at a
 * blank screen.
 *
 * Motivation: ISSUE-001 (QA, 2026-05-12) — `<Button asChild leadingIcon>`
 * threw `React.Children.only` from Radix Slot inside `NotFound`, with no
 * error boundary above it, which collapsed the entire React tree to an
 * empty `#root`. This component prevents that whole class of bugs from
 * ever blanking the app.
 *
 * Reset behavior: takes a `resetKey` prop (we pass `location.pathname`
 * from the caller). When the key changes, the boundary clears its error
 * state on the next render. So navigating away from a broken route
 * recovers automatically — the user doesn't have to refresh.
 *
 * React only supports class components for error boundaries
 * (getDerivedStateFromError / componentDidCatch). Hooks can't catch
 * render errors. So this stays a class even though everything else in
 * the app is functional. No external dep needed.
 *
 * IMPORTANT — what this boundary does NOT catch:
 *   - Errors in event handlers (use try/catch directly)
 *   - Errors in setTimeout / setInterval / async callbacks
 *   - Errors in Promise rejections (use .catch or window.onunhandledrejection)
 *   - Errors thrown during SSR (we don't have SSR; n/a)
 *   - Errors inside the boundary itself
 *
 * If you need to surface async errors, throw them back into a render
 * scope via a state setter so the boundary sees them.
 */

import * as React from "react";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button, Card } from "@/components/navigatr";

interface FallbackProps {
  error: Error;
  onReset: () => void;
}

/**
 * Functional fallback so we can use router hooks for the
 * "back to dashboard" button. Rendered by the boundary on error.
 */
function ErrorFallback({ error, onReset }: FallbackProps) {
  const navigate = useNavigate();
  const isDev = import.meta.env.DEV;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-12 sm:px-6 sm:py-16">
      <Card padding="xl" className="flex flex-col items-center gap-4 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-status-danger-bg text-status-danger">
          <AlertTriangle className="h-6 w-6" aria-hidden />
        </span>

        <div className="flex flex-col gap-1">
          <h1 className="text-heading-sm text-text-default">Something went wrong</h1>
          {/* IMPORTANT: this copy does NOT promise observability. Until Sentry
              is wired (Sprint 2 TODO in componentDidCatch), only console.error
              receives the stack. Saying "we've logged it" would be a lie. */}
          <p className="text-body-md text-text-muted">
            This page hit a snag. Try again, or head back to the dashboard.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="primary" size="md" leadingIcon={RefreshCw} onClick={onReset}>
            Try again
          </Button>
          <Button
            variant="secondary"
            size="md"
            leadingIcon={ArrowLeft}
            onClick={() => navigate("/dashboard")}
          >
            Back to dashboard
          </Button>
        </div>

        {/* Dev-only stack details. In production we don't surface the
            error message to the user — it can leak implementation details
            and is rarely useful to a non-engineer. The full error is
            still in the console.error log for any dev opening DevTools. */}
        {isDev && (
          <details className="w-full text-left">
            <summary className="cursor-pointer text-caption text-text-muted hover:text-text-default">
              Show error details (dev only)
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-radius-md bg-surface-sunken p-3 text-caption text-text-default">
              {error.message}
              {error.stack ? `\n\n${error.stack}` : ""}
            </pre>
          </details>
        )}
      </Card>
    </div>
  );
}

interface BoundaryProps {
  /** When this prop changes, any captured error is cleared. We pass
   *  location.pathname so navigating away recovers automatically. */
  resetKey: string;
  children: React.ReactNode;
}

interface BoundaryState {
  error: Error | null;
}

class ErrorBoundaryInner extends React.Component<BoundaryProps, BoundaryState> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidUpdate(prevProps: BoundaryProps) {
    // Auto-recover when the user navigates away. resetKey is the current
    // pathname, so a route change clears the error and we re-render the
    // new page from a clean slate.
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep the full error in the console so devs can debug from DevTools.
    // TODO Sprint 2: send to Sentry / observability backend here.
    // eslint-disable-next-line no-console
    console.error("[RouteErrorBoundary] render error:", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return <ErrorFallback error={this.state.error} onReset={this.handleReset} />;
    }
    return this.props.children;
  }
}

/**
 * Public wrapper — pulls `location.pathname` from React Router so callers
 * don't have to plumb it themselves. Use this around any route content
 * you want isolated.
 */
export function RouteErrorBoundary({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return (
    <ErrorBoundaryInner resetKey={location.pathname}>{children}</ErrorBoundaryInner>
  );
}

export default RouteErrorBoundary;
