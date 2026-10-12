/**
 * Shown for an unknown slug or a portal that is turned off. Deliberately says
 * nothing about any tenant (spec 5.4).
 */
import { Unlink } from "lucide-react";

export function PortalUnavailablePage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-canvas px-4">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
          <Unlink className="h-6 w-6" aria-hidden />
        </span>
        <h1 className="text-heading-lg text-text-default">This portal isn&apos;t available</h1>
        <p className="text-body-md text-text-muted">
          Check the link you were sent, or ask the person who invited you for a new one.
        </p>
      </div>
    </div>
  );
}
