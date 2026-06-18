import { describe, it, expect } from "vitest";
import { validateFile } from "./dealFileValidation";

describe("validateFile", () => {
  it("accepts a small image", () => {
    expect(validateFile({ size: 1024, type: "image/png" })).toEqual({ ok: true });
  });

  it("rejects a file larger than 10MB", () => {
    const result = validateFile({ size: 11 * 1024 * 1024, type: "application/pdf" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/10MB/);
  });

  it("rejects an unsupported file type", () => {
    const result = validateFile({ size: 1024, type: "application/x-msdownload" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Unsupported/);
  });

  it("accepts an allowed document type (pdf)", () => {
    expect(validateFile({ size: 1024, type: "application/pdf" })).toEqual({ ok: true });
  });
});
