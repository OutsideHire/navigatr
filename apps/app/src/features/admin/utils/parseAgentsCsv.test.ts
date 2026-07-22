import { describe, it, expect } from "vitest";
import { parseAgentsCsv } from "./parseAgentsCsv";

describe("parseAgentsCsv", () => {
  it("parses a simple two-row CSV", () => {
    const csv = "email,full_name\na@x.com,Alice\nb@x.com,Bob";
    const r = parseAgentsCsv(csv);
    expect(r.valid).toEqual([
      { email: "a@x.com", full_name: "Alice", role_level: "sales_professional" },
      { email: "b@x.com", full_name: "Bob", role_level: "sales_professional" },
    ]);
    expect(r.errors).toEqual([]);
  });

  it("rejects rows with missing email", () => {
    const csv = "email,full_name\n,Anonymous\nx@y.com,Real";
    const r = parseAgentsCsv(csv);
    expect(r.valid.map((v) => v.email)).toEqual(["x@y.com"]);
    expect(r.errors).toEqual([{ row: 2, reason: "missing_email", raw: ",Anonymous" }]);
  });

  it("rejects rows with malformed email", () => {
    const csv = "email,full_name\nnot-an-email,X";
    const r = parseAgentsCsv(csv);
    expect(r.valid).toEqual([]);
    expect(r.errors[0].reason).toBe("invalid_email");
  });

  it("auto-detects 'Email Address' and 'Full Name' header variants", () => {
    const csv = "Email Address,Full Name\n a@x.com , Alice ";
    const r = parseAgentsCsv(csv);
    expect(r.valid[0]).toEqual({ email: "a@x.com", full_name: "Alice", role_level: "sales_professional" });
  });

  it("defaults role_level to 'sales_professional' when the column is absent", () => {
    const csv = "email\na@x.com";
    expect(parseAgentsCsv(csv).valid[0].role_level).toBe("sales_professional");
  });

  it("accepts a valid role_level (case-insensitive)", () => {
    const csv = "email,role_level\na@x.com,SALES_MANAGER\nb@x.com,vp_sales";
    expect(parseAgentsCsv(csv).valid.map((v) => v.role_level)).toEqual([
      "sales_manager",
      "vp_sales",
    ]);
  });

  it("rejects an unknown role_level value", () => {
    const csv = "email,role_level\na@x.com,godmode";
    const r = parseAgentsCsv(csv);
    expect(r.valid).toEqual([]);
    expect(r.errors[0].reason).toBe("invalid_role_level");
  });

  it("defaults role_level when the column is present but blank", () => {
    const csv = "email,role_level\na@x.com,";
    expect(parseAgentsCsv(csv).valid[0].role_level).toBe("sales_professional");
  });

  it("carries reports_to_email through as reports_to", () => {
    const csv = "email,reports_to_email\na@x.com,boss@x.com";
    expect(parseAgentsCsv(csv).valid[0].reports_to).toBe("boss@x.com");
  });

  it("omits reports_to when the column is absent or blank", () => {
    const absent = parseAgentsCsv("email\na@x.com");
    expect(absent.valid[0].reports_to).toBeUndefined();
    const blank = parseAgentsCsv("email,reports_to_email\nb@x.com,");
    expect(blank.valid[0].reports_to).toBeUndefined();
  });

  it("dedupes within the file (keeps first, errors subsequent)", () => {
    const csv = "email\na@x.com\nA@X.com";
    const r = parseAgentsCsv(csv);
    expect(r.valid).toHaveLength(1);
    expect(r.errors[0].reason).toBe("duplicate_in_file");
  });
});
