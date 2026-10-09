/**
 * The portal's "could not reach" state: shown for a network failure, a 5xx, or
 * any unexpected error, so a flaky connection is never mistaken for a dead
 * invite, a wrong code, or a portal that does not exist.
 */
import { WifiOff } from "lucide-react";
import { Button, Card } from "@/components/navigatr";

export function portalReachMessage(name?: string | null): string {
  return `We couldn't reach ${name || "the portal"}. Check your connection and try again.`;
}

export function PortalRetry({
  name,
  onRetry,
  busy = false,
  fullPage = false,
}: {
  name?: string | null;
  onRetry: () => void;
  busy?: boolean;
  fullPage?: boolean;
}) {
  const body = (
    <Card padding="lg" className="flex flex-col items-center gap-3 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
        <WifiOff className="h-6 w-6" aria-hidden />
      </span>
      <p className="text-body-md text-text-default">{portalReachMessage(name)}</p>
      <Button variant="secondary" size="md" loading={busy} disabled={busy} onClick={onRetry}>
        Try again
      </Button>
    </Card>
  );
  if (!fullPage) return body;
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-canvas px-4">
      <div className="w-full max-w-sm">{body}</div>
    </div>
  );
}
