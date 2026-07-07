import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCalendarConnection } from "./useCalendarConnection";

// supabase.from("oauth_connections").select("status").eq("provider","google")
//   .eq("user_id", userId).maybeSingle() for the status read. connect() and
// disconnect() route through supabase.functions.invoke("calendar_oauth/start" |
// "calendar_oauth/disconnect") — the direct client write was removed once the
// Edge function landed. The read chain filters on provider AND user_id, so
// select().eq() returns an object with a further { eq } that resolves to
// { maybeSingle }.
const maybeSingle = vi.fn();
const selectUserEq = vi.fn(() => ({ maybeSingle }));
const selectEq = vi.fn(() => ({ eq: selectUserEq, maybeSingle }));
const select = vi.fn(() => ({ eq: selectEq }));
// vi.hoisted lifts the invoke spy above the hoisted vi.mock factory so the
// factory can reference it without a temporal-dead-zone error.
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ select }), functions: { invoke } },
}));

// useCalendarConnection scopes the read to the current auth user, so the query
// only runs once useAuth exposes a user id.
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } }) => unknown) =>
    selector({ user: { id: "user-1" } }),
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
  invoke.mockReset();
  select.mockClear();
  selectEq.mockClear();
  selectUserEq.mockClear();
});

describe("useCalendarConnection", () => {
  it("reports connected when the row status is active", async () => {
    maybeSingle.mockResolvedValueOnce({ data: { status: "active" }, error: null });
    const { result } = renderHook(() => useCalendarConnection(), { wrapper: wrap(makeClient()) });
    await waitFor(() => expect(result.current.status).toBe("connected"));
    // Read is scoped to provider AND the current auth user's id.
    expect(selectEq).toHaveBeenCalledWith("provider", "google");
    expect(selectUserEq).toHaveBeenCalledWith("user_id", "user-1");
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

  it("disconnect() invokes the calendar_oauth/disconnect Edge sub-route", async () => {
    maybeSingle.mockResolvedValue({ data: { status: "active" }, error: null });
    invoke.mockResolvedValueOnce({ data: { ok: true }, error: null });
    const { result } = renderHook(() => useCalendarConnection(), { wrapper: wrap(makeClient()) });
    await waitFor(() => expect(result.current.status).toBe("connected"));

    result.current.disconnect();

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("calendar_oauth/disconnect"));
  });

  it("connect() invokes the start sub-route and navigates to the returned authUrl", async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    invoke.mockResolvedValueOnce({
      data: { authUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=abc" },
      error: null,
    });
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, assign },
    });

    const { result } = renderHook(() => useCalendarConnection(), { wrapper: wrap(makeClient()) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    result.current.connect();

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("calendar_oauth/start"));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(assign.mock.calls[0][0]).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth?state=abc",
    );

    Object.defineProperty(window, "location", { configurable: true, value: original });
  });
});
