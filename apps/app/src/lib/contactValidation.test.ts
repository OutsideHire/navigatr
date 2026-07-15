import { describe, it, expect } from "vitest";
import {
  isValidUsPhone,
  phoneToE164,
  normalizeEmail,
  requiredPhoneSchema,
  optionalPhoneSchema,
  requiredEmailSchema,
  optionalEmailSchema,
} from "./contactValidation";

describe("isValidUsPhone", () => {
  it("accepts formatted, bare, and leading-1 US numbers", () => {
    expect(isValidUsPhone("(202) 555-0101")).toBe(true);
    expect(isValidUsPhone("2025550101")).toBe(true);
    expect(isValidUsPhone("1 (202) 555-0101")).toBe(true);
  });
  it("rejects too-short / empty", () => {
    expect(isValidUsPhone("555")).toBe(false);
    expect(isValidUsPhone("")).toBe(false);
  });
});

describe("phoneToE164", () => {
  it("normalizes valid input to E.164", () => {
    expect(phoneToE164("(202) 555-0101")).toBe("+12025550101");
    expect(phoneToE164("1 (202) 555-0101")).toBe("+12025550101");
  });
  it("returns null for empty/blank", () => {
    expect(phoneToE164("")).toBeNull();
    expect(phoneToE164("   ")).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("trims; empty → null", () => {
    expect(normalizeEmail("  a@b.com  ")).toBe("a@b.com");
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
  });
});

describe("phone schemas", () => {
  it("required rejects empty + bad, accepts valid", () => {
    expect(requiredPhoneSchema.safeParse("").success).toBe(false);
    expect(requiredPhoneSchema.safeParse("555").success).toBe(false);
    expect(requiredPhoneSchema.safeParse("2025550101").success).toBe(true);
  });
  it("optional allows empty, rejects bad, accepts valid", () => {
    expect(optionalPhoneSchema.safeParse("").success).toBe(true);
    expect(optionalPhoneSchema.safeParse("555").success).toBe(false);
    expect(optionalPhoneSchema.safeParse("2025550101").success).toBe(true);
  });
});

describe("email schemas", () => {
  it("required rejects empty + bad, accepts valid (trim-tolerant)", () => {
    expect(requiredEmailSchema.safeParse("").success).toBe(false);
    expect(requiredEmailSchema.safeParse("nope").success).toBe(false);
    expect(requiredEmailSchema.safeParse("a@b.com").success).toBe(true);
    expect(requiredEmailSchema.safeParse(" a@b.com ").success).toBe(true);
  });
  it("optional allows empty, rejects bad, accepts valid", () => {
    expect(optionalEmailSchema.safeParse("").success).toBe(true);
    expect(optionalEmailSchema.safeParse("nope").success).toBe(false);
    expect(optionalEmailSchema.safeParse("a@b.com").success).toBe(true);
  });
});
