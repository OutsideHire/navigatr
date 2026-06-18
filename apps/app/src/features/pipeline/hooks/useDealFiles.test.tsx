// Tests the deal_files hooks: the snake_case row -> camel DealFile mapping for
// the list query, and the upload/delete mutation flows. Storage I/O is mocked
// via ../lib/dealFileStorage; RLS + the org-derivation trigger are server-side
// concerns. Mirrors the chainable-mock scaffolding in useDealContacts.test.tsx.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useDealFiles, useUploadDealFile, useDeleteDealFile } from "./useDealFiles";
import { uploadDealFile, removeDealFile } from "../lib/dealFileStorage";

// ---- supabase mock (chainable builder, mirrors useDealContacts.test.tsx) ----
const orderMock = vi.fn();
const selectMock = vi.fn();
const insertMock = vi.fn();
const deleteMock = vi.fn();
const eqMock = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      void table;
      const builder = {
        select: (...args: unknown[]) => {
          selectMock(...args);
          return builder;
        },
        // The hook awaits `insert(...)` directly (no .select().single()
        // terminal), so insert must return the stubbed resolution, not the
        // chainable builder.
        insert: (...args: unknown[]) => insertMock(...args),
        delete: (...args: unknown[]) => {
          deleteMock(...args);
          return builder;
        },
        eq: (...args: unknown[]) => eqMock(...args) ?? builder,
        order: (...args: unknown[]) => orderMock(...args),
      };
      return builder;
    },
  },
}));

// ---- storage lib mock ----
vi.mock("../lib/dealFileStorage", () => ({
  uploadDealFile: vi.fn(),
  removeDealFile: vi.fn(),
}));

let authUserId: string | undefined;
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: authUserId ? { id: authUserId } : null }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  orderMock.mockReset();
  selectMock.mockClear();
  insertMock.mockReset();
  deleteMock.mockClear();
  eqMock.mockReset();
  vi.mocked(uploadDealFile).mockReset();
  vi.mocked(removeDealFile).mockReset();
  authUserId = "user-1";
});

/** Build a File with an overridden size without allocating real bytes. */
function fileOfSize(size: number, name: string, type: string): File {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

describe("useDealFiles (list)", () => {
  it("selects from deal_files filtered by deal_id, ordered descending, mapping rows to camel DealFile", async () => {
    eqMock.mockImplementation(() => ({ order: (...a: unknown[]) => orderMock(...a) }));
    orderMock.mockResolvedValueOnce({
      data: [
        {
          id: "df-1",
          deal_id: "deal-1",
          path: "deal-1/abc",
          name: "contract.pdf",
          size_bytes: 2048,
          content_type: "application/pdf",
          uploaded_by: "user-1",
          created_at: "2026-06-18T08:00:00Z",
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useDealFiles("deal-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(selectMock).toHaveBeenCalledWith("*");
    expect(eqMock).toHaveBeenCalledWith("deal_id", "deal-1");
    expect(orderMock).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(result.current.data).toEqual([
      {
        id: "df-1",
        dealId: "deal-1",
        path: "deal-1/abc",
        name: "contract.pdf",
        sizeBytes: 2048,
        contentType: "application/pdf",
        uploadedBy: "user-1",
        createdAt: "2026-06-18T08:00:00Z",
      },
    ]);
  });

  it("surfaces Supabase errors via isError", async () => {
    eqMock.mockImplementation(() => ({ order: (...a: unknown[]) => orderMock(...a) }));
    orderMock.mockResolvedValueOnce({
      data: null,
      error: { message: "permission denied for table deal_files" },
    });
    const { result } = renderHook(() => useDealFiles("deal-1"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeTruthy();
  });

  it("stays disabled when dealId is empty (no query fired)", () => {
    const { result } = renderHook(() => useDealFiles(""), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(orderMock).not.toHaveBeenCalled();
  });
});

describe("useUploadDealFile", () => {
  it("rejects an oversize file before uploading or inserting", async () => {
    const file = fileOfSize(11 * 1024 * 1024, "big.pdf", "application/pdf");
    const { result } = renderHook(() => useUploadDealFile(), { wrapper });

    await expect(result.current.mutateAsync({ dealId: "deal-1", file })).rejects.toThrow(/10MB/);
    expect(vi.mocked(uploadDealFile)).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("refuses to call storage/Supabase when not signed in", async () => {
    authUserId = undefined;
    const file = fileOfSize(1024, "ok.pdf", "application/pdf");
    const { result } = renderHook(() => useUploadDealFile(), { wrapper });
    await expect(result.current.mutateAsync({ dealId: "deal-1", file })).rejects.toThrow(
      /not signed in/i,
    );
    expect(vi.mocked(uploadDealFile)).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("uploads then inserts a deal_files row (NOT org_id) for a good file", async () => {
    vi.mocked(uploadDealFile).mockResolvedValueOnce("deal-1/generated-uuid");
    insertMock.mockReturnValue(Promise.resolve({ error: null }));
    const file = fileOfSize(2048, "ok.pdf", "application/pdf");

    const { result } = renderHook(() => useUploadDealFile(), { wrapper });
    await result.current.mutateAsync({ dealId: "deal-1", file });

    expect(vi.mocked(uploadDealFile)).toHaveBeenCalledWith(file, "deal-1");
    expect(insertMock).toHaveBeenCalledTimes(1);
    const payload = (insertMock.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload).toEqual({
      deal_id: "deal-1",
      path: "deal-1/generated-uuid",
      name: "ok.pdf",
      size_bytes: 2048,
      content_type: "application/pdf",
      uploaded_by: "user-1",
    });
    expect(payload).not.toHaveProperty("org_id");
  });

  it("invalidates the deal-files cache on success", async () => {
    vi.mocked(uploadDealFile).mockResolvedValueOnce("deal-1/uuid");
    insertMock.mockReturnValue(Promise.resolve({ error: null }));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const localWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const file = fileOfSize(2048, "ok.pdf", "application/pdf");
    const { result } = renderHook(() => useUploadDealFile(), { wrapper: localWrapper });
    await result.current.mutateAsync({ dealId: "deal-1", file });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    expect(invalidateSpy.mock.calls[0][0]).toEqual({ queryKey: ["deal-files", "deal-1"] });
  });

  it("best-effort removes the orphan object when the insert fails", async () => {
    vi.mocked(uploadDealFile).mockResolvedValueOnce("deal-1/orphan");
    vi.mocked(removeDealFile).mockResolvedValueOnce(undefined);
    insertMock.mockReturnValue(Promise.resolve({ error: { message: "insert denied" } }));
    const file = fileOfSize(2048, "ok.pdf", "application/pdf");
    const { result } = renderHook(() => useUploadDealFile(), { wrapper });
    await expect(result.current.mutateAsync({ dealId: "deal-1", file })).rejects.toMatchObject({
      message: "insert denied",
    });
    expect(vi.mocked(removeDealFile)).toHaveBeenCalledWith("deal-1/orphan");
  });
});

describe("useDeleteDealFile", () => {
  it("deletes the row by id then removes the object", async () => {
    eqMock.mockResolvedValueOnce({ error: null });
    const invocations: string[] = [];
    deleteMock.mockImplementation(() => invocations.push("delete"));
    vi.mocked(removeDealFile).mockImplementation(async () => {
      invocations.push("removeDealFile");
    });
    const { result } = renderHook(() => useDeleteDealFile(), { wrapper });
    await result.current.mutateAsync({ id: "df-1", dealId: "deal-1", path: "deal-1/abc" });
    expect(vi.mocked(removeDealFile)).toHaveBeenCalledWith("deal-1/abc");
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(eqMock).toHaveBeenCalledWith("id", "df-1");
    expect(invocations).toEqual(["delete", "removeDealFile"]);
  });

  it("throws when the row delete errors", async () => {
    vi.mocked(removeDealFile).mockResolvedValueOnce(undefined);
    eqMock.mockResolvedValueOnce({ error: { message: "delete denied" } });
    const { result } = renderHook(() => useDeleteDealFile(), { wrapper });
    await expect(
      result.current.mutateAsync({ id: "df-1", dealId: "deal-1", path: "deal-1/abc" }),
    ).rejects.toMatchObject({ message: "delete denied" });
  });

  it("invalidates the deal-files cache on success", async () => {
    vi.mocked(removeDealFile).mockResolvedValueOnce(undefined);
    eqMock.mockResolvedValueOnce({ error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const localWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useDeleteDealFile(), { wrapper: localWrapper });
    await result.current.mutateAsync({ id: "df-1", dealId: "deal-1", path: "deal-1/abc" });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    expect(invalidateSpy.mock.calls[0][0]).toEqual({ queryKey: ["deal-files", "deal-1"] });
  });
});
