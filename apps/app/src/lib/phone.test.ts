import { describe, it, expect } from "vitest";
import { formatPhone, formatPhoneDisplay, dialableDigits } from "./phone";

describe("formatPhone", () => {
  it("formats a 10-digit US number to national format", () => {
    const r = formatPhone("5125550100");
    expect(r.display).toBe("(512) 555-0100");
    expect(r.valid).toBe(true);
    expect(r.e164).toBe("+15125550100");
  });

  it("formats an E.164 US number to national format", () => {
    const r = formatPhone("+15125550100");
    expect(r.display).toBe("(512) 555-0100");
    expect(r.valid).toBe(true);
    expect(r.e164).toBe("+15125550100");
  });

  it("passes through an invalid/short number", () => {
    const r = formatPhone("123");
    expect(r.display).toBe("123");
    expect(r.valid).toBe(false);
    expect(r.e164).toBeNull();
  });

  it("passes through an empty string", () => {
    const r = formatPhone("");
    expect(r.display).toBe("");
    expect(r.valid).toBe(false);
  });

  it("formats a US number in international format when requested", () => {
    const r = formatPhone("+15125550100", "international");
    expect(r.display).toBe("+1 512 555 0100");
    expect(r.valid).toBe(true);
  });

  it("formats a valid non-US number in international format", () => {
    const r = formatPhone("+447911123456");
    expect(r.display).toBe("+44 7911 123456");
    expect(r.valid).toBe(true);
    expect(r.e164).toBe("+447911123456");
  });
});

describe("formatPhoneDisplay", () => {
  it("returns the national format for a valid US number", () => {
    expect(formatPhoneDisplay("+15125550100")).toBe("(512) 555-0100");
  });
  it("returns the raw string for an invalid number", () => {
    expect(formatPhoneDisplay("123")).toBe("123");
  });
});

describe("dialableDigits", () => {
  it("returns sanitized digits for a non-US but dialable number", () => {
    expect(dialableDigits("(02) 8850 1565")).toBe("0288501565");
  });

  it("preserves a leading + for international numbers", () => {
    expect(dialableDigits("+61 2 8850 1565")).toBe("+61288501565");
  });

  it("returns null for too-short input (< 7 digits)", () => {
    expect(dialableDigits("123")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(dialableDigits("")).toBeNull();
  });
});
