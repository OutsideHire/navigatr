import { describe, it, expect, vi, beforeEach } from "vitest";
import { uploadDealFile, signedUrlFor, removeDealFile } from "./dealFileStorage";

const uploadMock = vi.fn();
const createSignedUrlMock = vi.fn();
const removeMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    storage: {
      from: (...args: unknown[]) => {
        fromMock(...args);
        return {
          upload: (...a: unknown[]) => uploadMock(...a),
          createSignedUrl: (...a: unknown[]) => createSignedUrlMock(...a),
          remove: (...a: unknown[]) => removeMock(...a),
        };
      },
    },
  },
}));

beforeEach(() => {
  uploadMock.mockReset();
  createSignedUrlMock.mockReset();
  removeMock.mockReset();
  fromMock.mockReset();
  if (typeof crypto.randomUUID !== "function") {
    Object.defineProperty(crypto, "randomUUID", {
      value: () => "11111111-1111-1111-1111-111111111111",
      configurable: true,
    });
  }
});

describe("uploadDealFile", () => {
  it("uploads to the deal-files bucket under the deal folder and returns the path", async () => {
    uploadMock.mockResolvedValueOnce({ error: null });
    const file = new File(["hello"], "doc.pdf", { type: "application/pdf" });

    const path = await uploadDealFile(file, "deal-1");

    expect(fromMock).toHaveBeenCalledWith("deal-files");
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const [uploadedPath, uploadedFile, opts] = uploadMock.mock.calls[0] as unknown[];
    expect(uploadedPath as string).toMatch(/^deal-1\//);
    expect(uploadedFile).toBe(file);
    expect(opts).toEqual({ contentType: "application/pdf" });
    expect(path).toBe(uploadedPath);
  });

  it("throws when upload errors", async () => {
    uploadMock.mockResolvedValueOnce({ error: { message: "upload failed" } });
    const file = new File(["x"], "doc.pdf", { type: "application/pdf" });
    await expect(uploadDealFile(file, "deal-1")).rejects.toMatchObject({ message: "upload failed" });
  });
});

describe("signedUrlFor", () => {
  it("returns the signed URL", async () => {
    createSignedUrlMock.mockResolvedValueOnce({
      data: { signedUrl: "https://example.com/signed" },
      error: null,
    });
    const url = await signedUrlFor("deal-1/abc");
    expect(fromMock).toHaveBeenCalledWith("deal-files");
    expect(createSignedUrlMock).toHaveBeenCalledWith("deal-1/abc", 3600);
    expect(url).toBe("https://example.com/signed");
  });

  it("throws when signing errors", async () => {
    createSignedUrlMock.mockResolvedValueOnce({ data: null, error: { message: "sign failed" } });
    await expect(signedUrlFor("p")).rejects.toMatchObject({ message: "sign failed" });
  });
});

describe("removeDealFile", () => {
  it("removes the path from the bucket", async () => {
    removeMock.mockResolvedValueOnce({ error: null });
    await removeDealFile("p");
    expect(fromMock).toHaveBeenCalledWith("deal-files");
    expect(removeMock).toHaveBeenCalledWith(["p"]);
  });

  it("throws when remove errors", async () => {
    removeMock.mockResolvedValueOnce({ error: { message: "remove failed" } });
    await expect(removeDealFile("p")).rejects.toMatchObject({ message: "remove failed" });
  });
});
