import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useStopQualityNotes } from "./useStopQualityNotes";
import { GOOGLE_CLOSED_NOTE, SUPPRESSED_NOTE } from "../lib/stopQualityNote";

const invokeMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe("useStopQualityNotes", () => {
  it("asks once for the day's distinct deals, skipping stops with no deal", async () => {
    invokeMock.mockResolvedValue({ data: { enabled: true, flags: [] }, error: null });
    renderHook(() => useStopQualityNotes(["d2", null, "d1", undefined, "d2"]), { wrapper });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    expect(invokeMock).toHaveBeenCalledWith("path_quality_flags", { body: { deal_ids: ["d1", "d2"] } });
  });

  it("does not call at all when no stop has a deal", () => {
    renderHook(() => useStopQualityNotes([null, undefined]), { wrapper });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("maps each flagged deal to its note", async () => {
    invokeMock.mockResolvedValue({
      data: {
        enabled: true,
        flags: [
          { deal_id: "d1", google_closed: true, suppressed: false },
          { deal_id: "d2", google_closed: false, suppressed: true },
          { deal_id: "d3", google_closed: false, suppressed: false },
        ],
      },
      error: null,
    });
    const { result } = renderHook(() => useStopQualityNotes(["d1", "d2", "d3"]), { wrapper });
    await waitFor(() => expect(result.current.size).toBe(2));
    expect(result.current.get("d1")).toBe(GOOGLE_CLOSED_NOTE);
    expect(result.current.get("d2")).toBe(SUPPRESSED_NOTE);
    expect(result.current.has("d3")).toBe(false);
  });

  it("shows no notes when the switch is off", async () => {
    invokeMock.mockResolvedValue({ data: { enabled: false, flags: [] }, error: null });
    const { result } = renderHook(() => useStopQualityNotes(["d1"]), { wrapper });
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(result.current.size).toBe(0);
  });

  it("degrades to no notes when the service fails, instead of breaking the day", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    invokeMock.mockResolvedValue({ data: null, error: new Error("boom") });
    const { result } = renderHook(() => useStopQualityNotes(["d1"]), { wrapper });
    await waitFor(() => expect(err).toHaveBeenCalledWith("path_quality_flags_failed", expect.any(Error)));
    expect(result.current.size).toBe(0);
    err.mockRestore();
  });
});
