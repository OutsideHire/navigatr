import { describe, it, expect, vi } from "vitest";
import { PUBLIC_SEND_GUARD_MS, sendDelay, waitForFormAge } from "./publicFormTiming";

describe("send guard", () => {
  it("is the server's 3 second minimum plus half a second", () => {
    expect(PUBLIC_SEND_GUARD_MS).toBe(3_500);
  });

  it("waits out the rest of the guard, and never a negative time", () => {
    expect(sendDelay(10_000, 10_000)).toBe(3_500);
    expect(sendDelay(10_000, 12_000)).toBe(1_500);
    expect(sendDelay(10_000, 13_500)).toBe(0);
    expect(sendDelay(10_000, 60_000)).toBe(0);
  });

  it("sleeps only when the form is too fresh", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    await waitForFormAge(10_000, () => 11_000, sleep);
    expect(sleep).toHaveBeenCalledWith(2_500);
    sleep.mockClear();
    await waitForFormAge(10_000, () => 20_000, sleep);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("uses a real timer by default", async () => {
    vi.useFakeTimers();
    let done = false;
    const p = waitForFormAge(Date.now()).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(3_499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
    vi.useRealTimers();
  });
});
