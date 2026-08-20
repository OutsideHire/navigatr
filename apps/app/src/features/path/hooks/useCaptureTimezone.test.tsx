import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

const updateMutate = vi.fn();
let stored: string | null = null;
let loading = false;

vi.mock("./usePathPreferences", () => ({
  usePathTimezone: () => ({ data: stored, isLoading: loading }),
  useUpdateTimezone: () => ({ mutate: updateMutate }),
}));

import { useCaptureTimezone } from "./useCaptureTimezone";

// Control ONLY the device zone the hook reads, by spying on resolvedOptions.
// The Intl.DateTimeFormat constructor stays real, so isKnownTimezone still
// validates zones (mocking the whole constructor would break that check).
function mockDeviceZone(tz: string) {
  return vi
    .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
    .mockReturnValue({ timeZone: tz } as unknown as Intl.ResolvedDateTimeFormatOptions);
}

describe("useCaptureTimezone", () => {
  beforeEach(() => {
    updateMutate.mockClear();
    stored = null;
    loading = false;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes the device zone when none is stored", () => {
    mockDeviceZone("America/Chicago");
    renderHook(() => useCaptureTimezone());
    expect(updateMutate).toHaveBeenCalledWith("America/Chicago");
  });

  it("does nothing when a zone is already stored", () => {
    mockDeviceZone("America/Chicago");
    stored = "America/New_York";
    renderHook(() => useCaptureTimezone());
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("waits while the stored zone is still loading", () => {
    mockDeviceZone("America/Chicago");
    loading = true;
    renderHook(() => useCaptureTimezone());
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("does not write an unresolvable device zone", () => {
    mockDeviceZone("Mars/Olympus");
    renderHook(() => useCaptureTimezone());
    expect(updateMutate).not.toHaveBeenCalled();
  });
});
