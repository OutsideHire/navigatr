import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useRecordDial } from "./useRecordDial";

const insertMock = vi.fn(
  (): Promise<{ error: Error | null }> => Promise.resolve({ error: null }),
);
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ insert: insertMock }) },
}));

let authUserId: string | undefined;
let profileOrgId: string | undefined;
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: authUserId ? { id: authUserId } : null }),
}));
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({ data: profileOrgId ? { org_id: profileOrgId } : null }),
}));

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  insertMock.mockClear();
  authUserId = "user-1";
  profileOrgId = "org-1";
});

describe("useRecordDial", () => {
  it("inserts a phone/dial coverage_signal with the deal id + phone number", async () => {
    const { result } = renderHook(() => useRecordDial(), { wrapper: wrapper() });
    result.current.mutate({ dealId: "deal-1", phoneNumber: "+15551234567" });
    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1));
    expect(insertMock).toHaveBeenCalledWith({
      org_id: "org-1",
      user_id: "user-1",
      channel: "phone",
      signal_type: "dial",
      deal_id: "deal-1",
      source_metadata: { phone_number: "+15551234567" },
    });
  });

  it("skips the insert when there is no session", async () => {
    authUserId = undefined;
    const { result } = renderHook(() => useRecordDial(), { wrapper: wrapper() });
    result.current.mutate({ dealId: "deal-1", phoneNumber: "+15551234567" });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("skips the insert when the profile (org) is not loaded", async () => {
    profileOrgId = undefined;
    const { result } = renderHook(() => useRecordDial(), { wrapper: wrapper() });
    result.current.mutate({ dealId: "deal-1", phoneNumber: "+15551234567" });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("surfaces an insert error as mutation error state (without throwing to the caller)", async () => {
    insertMock.mockResolvedValueOnce({ error: new Error("rls denied") });
    const { result } = renderHook(() => useRecordDial(), { wrapper: wrapper() });
    result.current.mutate({ dealId: "deal-1", phoneNumber: "+15551234567" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual(new Error("rls denied"));
  });
});
