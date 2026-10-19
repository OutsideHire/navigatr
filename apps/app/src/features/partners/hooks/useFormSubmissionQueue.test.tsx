import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const orderMock = vi.fn();
const isMock = vi.fn();
const selectMock = vi.fn();
const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "referral_form_submissions") throw new Error(`unexpected table ${table}`);
      return {
        select: (...a: unknown[]) => {
          selectMock(...a);
          return {
            is: (...i: unknown[]) => {
              isMock(...i);
              return { is: (...i2: unknown[]) => { isMock(...i2); return { order: orderMock }; } };
            },
          };
        },
      };
    },
    rpc: (...a: unknown[]) => rpcMock(...a),
  },
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) => selector({ user: { id: "user-1" } }),
}));

import { useFormSubmissionAdvice, useFormSubmissionQueue } from "./useFormSubmissionQueue";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => {
  orderMock.mockReset(); isMock.mockReset(); selectMock.mockReset(); rpcMock.mockReset();
});

describe("useFormSubmissionQueue", () => {
  it("loads untriaged, unpurged submissions oldest first, never the IP", async () => {
    orderMock.mockResolvedValueOnce({
      data: [{
        id: "s-1", link_type: "user", assigned_user_id: "user-1", company_name: "Fresh Bakery",
        contact_name: "Ann", contact_email: "ann@fresh.example", contact_phone: "5550001111",
        notes: "Wants a demo", referred_by_text: "Jane", referrer_email: null,
        submitted_at: "2026-10-20T15:00:00+00:00",
      }],
      error: null,
    });
    const { result } = renderHook(() => useFormSubmissionQueue(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(isMock.mock.calls).toEqual([["triaged_at", null], ["purged_at", null]]);
    expect(orderMock).toHaveBeenCalledWith("submitted_at", { ascending: true });
    expect(selectMock.mock.calls[0][0]).not.toContain("submitter_ip");
    expect(selectMock).toHaveBeenCalledWith(
      "id, link_type, assigned_user_id, company_name, contact_name, contact_email, contact_phone, " +
        "notes, referred_by_text, referrer_email, submitted_at",
    );
    expect(result.current.data).toEqual([{
      id: "s-1", linkType: "user", assignedUserId: "user-1", companyName: "Fresh Bakery",
      contactName: "Ann", contactEmail: "ann@fresh.example", contactPhone: "5550001111",
      notes: "Wants a demo", referredByText: "Jane", referrerEmail: null,
      submittedAt: "2026-10-20T15:00:00+00:00",
    }]);
  });

  it("does not fetch when disabled", async () => {
    const { result } = renderHook(() => useFormSubmissionQueue({ enabled: false }), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.fetchStatus).toBe("idle");
    expect(orderMock).not.toHaveBeenCalled();
  });

  it("surfaces a load error", async () => {
    orderMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const { result } = renderHook(() => useFormSubmissionQueue(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useFormSubmissionAdvice", () => {
  it("maps duplicates and the chain brand", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ dup_referral_id: "r-1", dup_referral_company: "Corner Cafe", dup_deal_id: "d-1", dup_deal_company: "Fresh Bakery", chain_brand: "Subway" }],
      error: null,
    });
    const { result } = renderHook(() => useFormSubmissionAdvice("s-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith("form_submission_advice", { p_submission_id: "s-1" });
    expect(result.current.data).toEqual({
      duplicateReferral: { id: "r-1", companyName: "Corner Cafe" },
      duplicateDeal: { id: "d-1", companyName: "Fresh Bakery" },
      chainBrand: "Subway",
    });
  });

  it("returns no advice when nothing matches, and does not run without an id", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ dup_referral_id: null, dup_referral_company: null, dup_deal_id: null, dup_deal_company: null, chain_brand: null }],
      error: null,
    });
    const { result } = renderHook(() => useFormSubmissionAdvice("s-2"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ duplicateReferral: null, duplicateDeal: null, chainBrand: null });
    renderHook(() => useFormSubmissionAdvice(null), { wrapper });
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});
