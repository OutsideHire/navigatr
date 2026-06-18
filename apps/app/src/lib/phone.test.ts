import { describe, it, expect } from "vitest";
import { formatPhone, formatPhoneDisplay } from "./phone";

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
});

describe("formatPhoneDisplay", () => {
  it("returns the national format for a valid US number", () => {
    expect(formatPhoneDisplay("+15125550100")).toBe("(512) 555-0100");
  });
  it("returns the raw string for an invalid number", () => {
    expect(formatPhoneDisplay("123")).toBe("123");
  });
});
