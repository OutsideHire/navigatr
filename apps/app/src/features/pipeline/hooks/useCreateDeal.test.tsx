// Tests the camelCase→snake_case translation, org/owner derivation, and
// error propagation. RLS itself is server-side and tested via the SQL
// editor smoke test in the verification doc — here we just confirm the
// hook forms the right insert payload and surfaces failures.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useCreateDeal, DuplicateDealError } from "./useCreateDeal";

const singleMock = vi.fn();
const selectMock = vi.fn(() => ({ single: singleMock }));
const insertMock = vi.fn(() => ({ select: selectMock }));
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
  useProfile: () => ({
    data: profileOrgId ? { org_id: profileOrgId } : null,
  }),
}));

// A deal created WITH a follow-up date should reconcile a calendar event on
// the create path (nothing else fires sync there). Mock it so we can assert
// it fires with the NEW deal's id — and only when a follow-up was set.
const syncFollowupMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/features/appointments/useFollowupSync", () => ({
  useFollowupSync: () => ({ syncFollowup: syncFollowupMock }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  insertMock.mockClear();
  selectMock.mockClear();
  singleMock.mockReset();
  syncFollowupMock.mockClear();
  authUserId = "user-1";
  profileOrgId = "org-1";
});

describe("useCreateDeal", () => {
  it("translates camelCase input to snake_case insert payload, with org_id + owner_id from the session", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "deal-new" }, error: null });

    const { result } = renderHook(() => useCreateDeal(), { wrapper });
    await result.current.mutateAsync({
      companyName: "Acme",
      contactName: "Jane",
      contactEmail: "j@acme.com",
      contactPhone: "+12025550100",
      valueCents: 500_000,
      stage: "new",
      probability: 20,
    });

    expect(insertMock).toHaveBeenCalledTimes(1);
    const calls = insertMock.mock.calls as unknown as Array<[Record<string, unknown>]>;
    const payload = calls[0]?.[0];
    expect(payload).toMatchObject({
      org_id: "org-1",
      owner_id: "user-1",
      company_name: "Acme",
      contact_name: "Jane",
      contact_email: "j@acme.com",
      contact_phone: "+12025550100",
      value_cents: 500_000,
      stage: "new",
      probability: 20,
      // Optional fields are explicitly null so PostgREST doesn't error on
      // missing columns / silently rely on table defaults we might change.
      address: null,
      industry: null,
      employee_count_range: null,
      contact_title: null,
      expected_close: null,
      lead_source: null,
      notes: null,
      next_followup_at: null,
      profession_data: {},
    });
  });

  it("inserts null contact_email/value_cents when omitted (field-sourced deal)", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "deal-field" }, error: null });

    const { result } = renderHook(() => useCreateDeal(), { wrapper });
    await result.current.mutateAsync({
      companyName: "Curbside Coffee",
      contactName: "Curbside Coffee",
      contactPhone: "+12025550100",
      stage: "new",
      probability: 20,
      leadSource: "path_dropin",
    });

    expect(insertMock).toHaveBeenCalledTimes(1);
    const calls = insertMock.mock.calls as unknown as Array<[Record<string, unknown>]>;
    const payload = calls[0]?.[0];
    expect(payload).toMatchObject({
      company_name: "Curbside Coffee",
      contact_name: "Curbside Coffee",
      contact_phone: "+12025550100",
      lead_source: "path_dropin",
      // Omitted email + value coalesce to null for Places-only drop-in deals.
      contact_email: null,
      value_cents: null,
    });
  });

  it("packs profession-specific fields into profession_data JSONB", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "deal-prof" }, error: null });
    const { result } = renderHook(() => useCreateDeal(), { wrapper });
    await result.current.mutateAsync({
      companyName: "Mer Co",
      contactName: "X",
      contactEmail: "x@m.co",
      contactPhone: "+10000000000",
      valueCents: 0,
      stage: "new",
      probability: 20,
      professionData: {
        profession: "merchant_services",
        annualVolume: 1_000_000,
        acceptanceMethods: ["card_present", "ecommerce"],
      },
    });
    const calls = insertMock.mock.calls as unknown as Array<[Record<string, unknown>]>;
    const payload = calls[0]?.[0];
    expect(payload?.profession_data).toEqual({
      profession: "merchant_services",
      annualVolume: 1_000_000,
      acceptanceMethods: ["card_present", "ecommerce"],
    });
  });

  it("returns the inserted id", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "deal-xyz" }, error: null });
    const { result } = renderHook(() => useCreateDeal(), { wrapper });
    const out = await result.current.mutateAsync({
      companyName: "C", contactName: "C", contactEmail: "c@c.co",
      contactPhone: "+10000000000", valueCents: 0, stage: "new", probability: 20,
    });
    expect(out).toEqual({ id: "deal-xyz" });
  });

  it("throws when Supabase returns an error (e.g. RLS denial)", async () => {
    singleMock.mockResolvedValueOnce({
      data: null,
      error: { message: "new row violates row-level security policy" },
    });
    const { result } = renderHook(() => useCreateDeal(), { wrapper });
    await expect(
      result.current.mutateAsync({
        companyName: "Leak", contactName: "Leak", contactEmail: "x@x.x",
        contactPhone: "+10000000000", valueCents: 0, stage: "new", probability: 20,
      }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/row-level security/) });
  });

  it("refuses to call Supabase when not signed in", async () => {
    authUserId = undefined;
    const { result } = renderHook(() => useCreateDeal(), { wrapper });
    await expect(
      result.current.mutateAsync({
        companyName: "X", contactName: "X", contactEmail: "x@x.x",
        contactPhone: "+10000000000", valueCents: 0, stage: "new", probability: 20,
      }),
    ).rejects.toThrow(/not signed in/i);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("refuses to call Supabase when the profile hasn't loaded (no org_id)", async () => {
    profileOrgId = undefined;
    const { result } = renderHook(() => useCreateDeal(), { wrapper });
    await expect(
      result.current.mutateAsync({
        companyName: "X", contactName: "X", contactEmail: "x@x.x",
        contactPhone: "+10000000000", valueCents: 0, stage: "new", probability: 20,
      }),
    ).rejects.toThrow(/profile/i);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("invalidates the deals list cache on success", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "deal-cache" }, error: null });

    // Fresh client we can spy on.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    const localWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useCreateDeal(), { wrapper: localWrapper });
    await result.current.mutateAsync({
      companyName: "X", contactName: "X", contactEmail: "x@x.x",
      contactPhone: "+10000000000", valueCents: 0, stage: "new", probability: 20,
    });

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    expect(invalidateSpy.mock.calls[0][0]).toEqual({
      queryKey: ["deals", "list", "user-1"],
    });
  });

  it("fires the calendar follow-up sync with the new deal id when a follow-up date was set", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "deal-followup" }, error: null });
    const { result } = renderHook(() => useCreateDeal(), { wrapper });
    await result.current.mutateAsync({
      companyName: "X", contactName: "X", contactEmail: "x@x.x",
      contactPhone: "+10000000000", valueCents: 0, stage: "new", probability: 20,
      nextFollowupAt: "2026-06-04T00:00:00Z",
    });
    await waitFor(() => expect(syncFollowupMock).toHaveBeenCalledWith("deal-followup"));
  });

  it("does NOT fire the follow-up sync when the deal has no follow-up date", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "deal-nofollow" }, error: null });
    const { result } = renderHook(() => useCreateDeal(), { wrapper });
    await result.current.mutateAsync({
      companyName: "X", contactName: "X", contactEmail: "x@x.x",
      contactPhone: "+10000000000", valueCents: 0, stage: "new", probability: 20,
    });
    // Give onSuccess a tick to run.
    await new Promise((r) => setTimeout(r, 0));
    expect(syncFollowupMock).not.toHaveBeenCalled();
  });

  it("stamps place_id onto the insert payload when provided", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "deal-pid" }, error: null });
    const { result } = renderHook(() => useCreateDeal(), { wrapper });
    await result.current.mutateAsync({
      companyName: "Bluewater", contactName: "Bluewater",
      contactPhone: "+12025550100", stage: "new", probability: 20,
      leadSource: "path_dropin", placeId: "gp-blue-1",
    });
    const calls = insertMock.mock.calls as unknown as Array<[Record<string, unknown>]>;
    expect(calls[0]?.[0]).toMatchObject({ place_id: "gp-blue-1" });
  });

  it("inserts null place_id when omitted (manual deal)", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "deal-nopid" }, error: null });
    const { result } = renderHook(() => useCreateDeal(), { wrapper });
    await result.current.mutateAsync({
      companyName: "Acme", contactName: "Jane", contactPhone: "+12025550100",
      stage: "new", probability: 20,
    });
    const calls = insertMock.mock.calls as unknown as Array<[Record<string, unknown>]>;
    expect(calls[0]?.[0]).toMatchObject({ place_id: null });
  });

  it("throws DuplicateDealError on a unique-violation (23505)", async () => {
    singleMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "deals_org_place_active_uidx"',
      },
    });
    const { result } = renderHook(() => useCreateDeal(), { wrapper });
    await expect(
      result.current.mutateAsync({
        companyName: "Dupe", contactName: "Dupe", contactPhone: "+12025550100",
        stage: "new", probability: 20, placeId: "gp-dupe-1",
      }),
    ).rejects.toBeInstanceOf(DuplicateDealError);
  });

  it("rethrows a 23505 from a DIFFERENT unique constraint as-is (not a DuplicateDealError)", async () => {
    singleMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "deals_source_dedupe_idx"',
      },
    });
    const { result } = renderHook(() => useCreateDeal(), { wrapper });
    let caught: unknown;
    try {
      await result.current.mutateAsync({
        companyName: "Dupe", contactName: "Dupe", contactPhone: "+12025550100",
        stage: "new", probability: 20, placeId: "gp-dupe-1",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeInstanceOf(DuplicateDealError);
    expect((caught as { code?: string })?.code).toBe("23505");
    expect((caught as { message?: string })?.message).toContain("deals_source_dedupe_idx");
  });

  it("rethrows a non-23505 error as-is", async () => {
    singleMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: "23503",
        message: "insert or update on table violates foreign key constraint",
      },
    });
    const { result } = renderHook(() => useCreateDeal(), { wrapper });
    let caught: unknown;
    try {
      await result.current.mutateAsync({
        companyName: "Dupe", contactName: "Dupe", contactPhone: "+12025550100",
        stage: "new", probability: 20, placeId: "gp-dupe-1",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeInstanceOf(DuplicateDealError);
    expect((caught as { code?: string })?.code).toBe("23503");
  });
});
