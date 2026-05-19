// Tests the camelCase→snake_case translation, org/owner derivation, and
// error propagation. RLS itself is server-side and tested via the SQL
// editor smoke test in the verification doc — here we just confirm the
// hook forms the right insert payload and surfaces failures.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useCreateDeal } from "./useCreateDeal";

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
    const payload = insertMock.mock.calls[0][0];
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
    const payload = insertMock.mock.calls[0][0];
    expect(payload.profession_data).toEqual({
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
});
