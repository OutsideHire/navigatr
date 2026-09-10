/**
 * DiscoveryRetryButton: the "Retry" button on Path's discovery-error cards,
 * with a built-in cooldown.
 *
 * Retrying discovery re-runs an expensive Google Places fan-out. Mashing this
 * button was an amplifier in the 2026-09-10 quota outage, so after a click the
 * button disables and counts down before it can fire again.
 */
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/navigatr";
import { useRetryCooldown } from "../hooks/useRetryCooldown";

export interface DiscoveryRetryButtonProps {
  /** Fire the retry (e.g. react-query refetch). */
  onRetry: () => void;
  /** Optional leading icon (matches the surrounding card's styling). */
  leadingIcon?: LucideIcon;
  /** Seconds to disable the button after a click. Default 20. */
  cooldownSeconds?: number;
}

export function DiscoveryRetryButton({
  onRetry,
  leadingIcon,
  cooldownSeconds = 20,
}: DiscoveryRetryButtonProps) {
  const cooldown = useRetryCooldown(cooldownSeconds);
  return (
    <Button
      variant="secondary"
      size="sm"
      leadingIcon={leadingIcon}
      disabled={cooldown.cooling}
      onClick={() => {
        onRetry();
        cooldown.arm();
      }}
    >
      {cooldown.cooling ? `Try again in ${cooldown.remaining}s` : "Retry"}
    </Button>
  );
}
