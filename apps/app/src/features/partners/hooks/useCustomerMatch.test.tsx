import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useCustomerMatch } from "./useCustomerMatch";

const rpc = vi.fn();
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => rpc.mockReset());

describe("useCustomerMatch", () => {
  it("returns the won deal that matches", async () => {
    rpc.mockResolvedValueOnce({ data: [{ deal_id: "d-1", company_name: "Old Bakery" }], error: null });
    const { result } = renderHook(
      () => useCustomerMatch({ company: "Old Bakery", phone: "555-010-0003", address: "30 Pine Rd" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ dealId: "d-1", companyName: "Old Bakery" });
    expect(rpc).toHaveBeenCalledWith("referral_customer_match", {
      p_company: "Old Bakery", p_phone: "555-010-0003", p_address: "30 Pine Rd",
    });
  });

  it("returns null when nothing matches", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    const { result } = renderHook(() => useCustomerMatch({ company: "Nope", phone: null, address: null }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(rpc).toHaveBeenCalledWith("referral_customer_match", { p_company: "Nope", p_phone: null, p_address: null });
  });

  it("surfaces an error", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const { result } = renderHook(() => useCustomerMatch({ company: "X", phone: null, address: null }), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("does not run without a company or phone", () => {
    const { result } = renderHook(() => useCustomerMatch({ company: "", phone: null, address: null }), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not run when disabled", () => {
    const { result } = renderHook(() => useCustomerMatch({ company: "X", phone: null, address: null, enabled: false }), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(rpc).not.toHaveBeenCalled();
  });
});
