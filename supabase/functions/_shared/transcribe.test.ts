import { describe, it, expect, vi } from "vitest";
import {
  MAX_AUDIO_BASE64_CHARS,
  MAX_AUDIO_BYTES,
  MOCK_TRANSCRIPT,
  PORTAL_MAX_AUDIO_BASE64_CHARS,
  PORTAL_MAX_AUDIO_BYTES,
  base64ToBytes,
  transcribeWithAssemblyAI,
  type AssemblyAIDeps,
} from "./transcribe";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function deps(responses: Response[], extra: Partial<AssemblyAIDeps> = {}) {
  const fetch = vi.fn(async (_input: string, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    return next;
  });
  const sleep = vi.fn(async (_ms: number) => {});
  return { fetch, sleep, d: { fetch, sleep, apiKey: "key-123", ...extra } as AssemblyAIDeps };
}

const AUDIO = new Uint8Array([1, 2, 3]);

describe("base64ToBytes", () => {
  it("decodes base64", () => {
    expect(Array.from(base64ToBytes(btoa("abc")))).toEqual([97, 98, 99]);
  });
  it("throws on input that is not base64", () => {
    expect(() => base64ToBytes("***")).toThrow();
  });
  it("sizes the base64 cap to the byte cap", () => {
    expect(MAX_AUDIO_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_AUDIO_BASE64_CHARS).toBe(Math.ceil(MAX_AUDIO_BYTES / 3) * 4);
    expect(MOCK_TRANSCRIPT).toBe("This is a mock transcription for local development.");
  });
  it("caps portal audio at 2 MB decoded, while the rep cap stays at 10 MB", () => {
    expect(PORTAL_MAX_AUDIO_BYTES).toBe(2 * 1024 * 1024);
    expect(PORTAL_MAX_AUDIO_BASE64_CHARS).toBe(Math.ceil(PORTAL_MAX_AUDIO_BYTES / 3) * 4);
    expect(PORTAL_MAX_AUDIO_BYTES).toBeLessThan(MAX_AUDIO_BYTES);
  });
});

describe("transcribeWithAssemblyAI", () => {
  it("uploads, creates the job, polls, and returns the text", async () => {
    const { fetch, sleep, d } = deps([
      json({ upload_url: "https://cdn.aai/u1" }),
      json({ id: "t1" }),
      json({ status: "processing" }),
      json({ status: "completed", text: "Signed the deal" }),
    ]);
    await expect(transcribeWithAssemblyAI(AUDIO, d)).resolves.toBe("Signed the deal");

    expect(fetch.mock.calls[0][0]).toBe("https://api.assemblyai.com/v2/upload");
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: "POST", headers: { authorization: "key-123" }, body: AUDIO });
    expect(fetch.mock.calls[1][0]).toBe("https://api.assemblyai.com/v2/transcript");
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({
      audio_url: "https://cdn.aai/u1",
      punctuate: true,
      format_text: true,
    });
    expect(fetch.mock.calls[2][0]).toBe("https://api.assemblyai.com/v2/transcript/t1");
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("refuses to run without an API key", async () => {
    const { fetch, d } = deps([], { apiKey: "" });
    await expect(transcribeWithAssemblyAI(AUDIO, d)).rejects.toThrow(/ASSEMBLYAI_API_KEY/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["upload http", [json({}, 500)]],
    ["upload returned no url", [json({})]],
    ["create http", [json({ upload_url: "u" }), json({}, 400)]],
    ["create returned no id", [json({ upload_url: "u" }), json({})]],
    ["poll http", [json({ upload_url: "u" }), json({ id: "t" }), json({}, 502)]],
    ["bad audio", [json({ upload_url: "u" }), json({ id: "t" }), json({ status: "error", error: "bad audio" })]],
  ])("throws on %s", async (message, responses) => {
    const { d } = deps(responses as Response[]);
    await expect(transcribeWithAssemblyAI(AUDIO, d)).rejects.toThrow(message);
  });

  it("times out when the job never completes", async () => {
    let t = 0;
    const { d } = deps(
      [json({ upload_url: "u" }), json({ id: "t" }), json({ status: "processing" }), json({ status: "processing" })],
      { nowMs: () => (t += 30_000), pollTimeoutMs: 45_000 },
    );
    await expect(transcribeWithAssemblyAI(AUDIO, d)).rejects.toThrow("transcription timed out");
  });

  it("returns an empty string for a completed job with no text", async () => {
    const { d } = deps([json({ upload_url: "u" }), json({ id: "t" }), json({ status: "completed" })]);
    await expect(transcribeWithAssemblyAI(AUDIO, d)).resolves.toBe("");
  });
});
