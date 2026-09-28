import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

const updateMutate = vi.fn();
let stored: string | null = null;
// The query's real outcome, not just "am I still loading". A read that ERRORED
// also leaves `data` undefined, and the hook must tell the two apart.
let status: "success" | "loading" | "error" = "success";

vi.mock("./usePathPreferences", () => ({
  usePathTimezone: () => ({
    data: stored,
    isLoading: status === "loading",
    isError: status === "error",
    isSuccess: status === "success",
  }),
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
    status = "success";
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
    status = "loading";
    renderHook(() => useCaptureTimezone());
    expect(updateMutate).not.toHaveBeenCalled();
  });

  // The regression. A failed read looks exactly like "nothing stored yet" from
  // `data` alone, so the hook used to fire a doomed write on every broken Path
  // load (one wasted request, one Sentry event). The data risk is worse than
  // the noise: if the read fails but a later write lands, a rep who had set
  // their zone deliberately gets it replaced by their device zone, which moves
  // their whole day boundary.
  it("does NOT write when the stored-zone read errored", () => {
    mockDeviceZone("America/Chicago");
    status = "error";
    renderHook(() => useCaptureTimezone());
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("does not write an unresolvable device zone", () => {
    mockDeviceZone("Mars/Olympus");
    renderHook(() => useCaptureTimezone());
    expect(updateMutate).not.toHaveBeenCalled();
  });
});
