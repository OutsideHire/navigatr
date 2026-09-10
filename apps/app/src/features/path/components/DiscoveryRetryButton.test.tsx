/**
 * DiscoveryRetryButton.test.tsx: the discovery Retry button fires the retry
 * once, then locks itself out for a cooldown so a rep can't re-fire the Places
 * fan-out by mashing it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { DiscoveryRetryButton } from "./DiscoveryRetryButton";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("DiscoveryRetryButton", () => {
  it("fires onRetry on click, then disables with a countdown, then re-enables", () => {
    const onRetry = vi.fn();
    render(<DiscoveryRetryButton onRetry={onRetry} cooldownSeconds={20} />);

    const btn = screen.getByRole("button", { name: /retry/i });
    expect(btn).toBeEnabled();

    fireEvent.click(btn);
    expect(onRetry).toHaveBeenCalledTimes(1);
    // Now cooling: disabled + countdown label.
    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByRole("button")).toHaveTextContent(/try again in 20s/i);

    // A second click while cooling does nothing.
    fireEvent.click(screen.getByRole("button"));
    expect(onRetry).toHaveBeenCalledTimes(1);

    // After the cooldown elapses, it re-enables and says "Retry" again.
    act(() => vi.advanceTimersByTime(20_000));
    expect(screen.getByRole("button")).toBeEnabled();
    expect(screen.getByRole("button")).toHaveTextContent(/^retry$/i);
  });
});
