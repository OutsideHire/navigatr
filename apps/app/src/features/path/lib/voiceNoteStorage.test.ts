import { describe, it, expect, vi, beforeEach } from "vitest";

const uploadMock = vi.fn();
const createSignedUrlMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { storage: { from: vi.fn(() => ({ upload: uploadMock, createSignedUrl: createSignedUrlMock })) } },
}));
import { extFor, uploadVoiceNote, signedUrlFor } from "./voiceNoteStorage";

beforeEach(() => { uploadMock.mockReset(); createSignedUrlMock.mockReset(); });

describe("voiceNoteStorage", () => {
  it("extFor maps known mime types, defaults to webm", () => {
    expect(extFor("audio/webm;codecs=opus")).toBe("webm");
    expect(extFor("audio/mp4")).toBe("m4a");
    expect(extFor("audio/weird")).toBe("webm");
  });
  it("uploadVoiceNote uploads under {userId}/ and returns the path", async () => {
    uploadMock.mockResolvedValueOnce({ data: {}, error: null });
    const path = await uploadVoiceNote(new Blob(["x"], { type: "audio/webm" }), "audio/webm", "user-1");
    expect(path).toMatch(/^user-1\/.+\.webm$/);
    expect(uploadMock).toHaveBeenCalledWith(path, expect.any(Blob), { contentType: "audio/webm" });
  });
  it("uploadVoiceNote throws on storage error", async () => {
    uploadMock.mockResolvedValueOnce({ data: null, error: new Error("boom") });
    await expect(uploadVoiceNote(new Blob(["x"]), "audio/webm", "u")).rejects.toThrow();
  });
  it("signedUrlFor returns the signed url", async () => {
    createSignedUrlMock.mockResolvedValueOnce({ data: { signedUrl: "https://signed" }, error: null });
    await expect(signedUrlFor("user-1/abc.webm")).resolves.toBe("https://signed");
  });
});
