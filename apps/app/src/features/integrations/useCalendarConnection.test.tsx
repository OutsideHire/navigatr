import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCalendarConnection } from "./useCalendarConnection";

// supabase.from("oauth_connections").select("status").eq("provider","google").maybeSingle()
// and .update({...}).eq("provider","google"). eq is the last call in the update
// chain, so it resolves the update; in the read chain it returns { maybeSingle }.
const maybeSingle = vi.fn();
const updateEq = vi.fn();
const update = vi.fn(() => ({ eq: updateEq }));
const selectEq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq: selectEq }));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ select, update }) },
}));

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

beforeEach(() => {
  maybeSingle.mockReset();
  updateEq.mockReset();
  update.mockClear();
  select.mockClear();
  selectEq.mockClear();
});

describe("useCalendarConnection", () => {
  it("reports connected when the row status is active", async () => {
    maybeSingle.mockResolvedValueOnce({ data: { status: "active" }, error: null });
    const { result } = renderHook(() => useCalendarConnection(), { wrapper: wrap(makeClient()) });
    await waitFor(() => expect(result.current.status).toBe("connected"));
  });

  it("reports disconnected when there is no row", async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const { result } = renderHook(() => useCalendarConnection(), { wrapper: wrap(makeClient()) });
    // status defaults to "disconnected"; confirm the query settled there.
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.status).toBe("disconnected");
  });

  it("reports pending when the row status is pending", async () => {
    maybeSingle.mockResolvedValueOnce({ data: { status: "pending" }, error: null });
    const { result } = renderHook(() => useCalendarConnection(), { wrapper: wrap(makeClient()) });
    await waitFor(() => expect(result.current.status).toBe("pending"));
  });

  it("reports disconnected when the row status is revoked", async () => {
    maybeSingle.mockResolvedValueOnce({ data: { status: "revoked" }, error: null });
    const { result } = renderHook(() => useCalendarConnection(), { wrapper: wrap(makeClient()) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.status).toBe("disconnected");
  });

  it("disconnect() updates the row status to revoked for provider google", async () => {
    maybeSingle.mockResolvedValue({ data: { status: "active" }, error: null });
    updateEq.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useCalendarConnection(), { wrapper: wrap(makeClient()) });
    await waitFor(() => expect(result.current.status).toBe("connected"));

    result.current.disconnect();

    await waitFor(() => expect(update).toHaveBeenCalledWith({ status: "revoked" }));
    expect(updateEq).toHaveBeenCalledWith("provider", "google");
  });

  it("connect() navigates to the OAuth start URL", async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, assign },
    });

    const { result } = renderHook(() => useCalendarConnection(), { wrapper: wrap(makeClient()) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    result.current.connect();

    expect(assign).toHaveBeenCalledTimes(1);
    const url = assign.mock.calls[0][0] as string;
    expect(url).toContain("calendar_oauth");
    expect(url).toContain("action=start");

    Object.defineProperty(window, "location", { configurable: true, value: original });
  });
});
