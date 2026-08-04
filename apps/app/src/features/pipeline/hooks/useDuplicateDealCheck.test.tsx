// useDuplicateDealCheck — the soft, pre-submit duplicate lookup. Verifies it
// maps the RPC row, short-circuits on blank inputs, and stays advisory (returns
// null, never throws) when the RPC errors.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDuplicateDealCheck } from "./useDuplicateDealCheck";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

beforeEach(() => {
  rpcMock.mockReset();
});

describe("useDuplicateDealCheck", () => {
  it("returns the matched active deal mapped to camelCase", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ id: "deal-1", company_name: "Behn Mouthpieces", stage: "new", owner_id: "u-1" }],
      error: null,
    });
    const { result } = renderHook(() => useDuplicateDealCheck());
    const match = await result.current.checkDuplicate("Behn Mouthpieces", "123 Main St");
    expect(rpcMock).toHaveBeenCalledWith("find_active_duplicate_deal", {
      p_name: "Behn Mouthpieces",
      p_address: "123 Main St",
    });
    expect(match).toEqual({
      id: "deal-1",
      companyName: "Behn Mouthpieces",
      stage: "new",
      ownerId: "u-1",
    });
  });

  it("returns null when the RPC finds nothing", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    const { result } = renderHook(() => useDuplicateDealCheck());
    expect(await result.current.checkDuplicate("New Co", "9 Elm St")).toBeNull();
  });

  it("short-circuits without calling the RPC when name or address is blank", async () => {
    const { result } = renderHook(() => useDuplicateDealCheck());
    expect(await result.current.checkDuplicate("Some Co", "")).toBeNull();
    expect(await result.current.checkDuplicate("", "123 Main St")).toBeNull();
    expect(await result.current.checkDuplicate("  ", "   ")).toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("stays advisory: an RPC error resolves to null, never throws", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const { result } = renderHook(() => useDuplicateDealCheck());
    await expect(result.current.checkDuplicate("Co", "123 Main St")).resolves.toBeNull();
  });
});
