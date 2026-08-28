import { describe, it, expect } from "vitest";
import { parseAgentsCsv } from "./parseAgentsCsv";

describe("parseAgentsCsv", () => {
  it("parses a simple two-row CSV", () => {
    const csv = "email,full_name\na@x.com,Alice\nb@x.com,Bob";
    const r = parseAgentsCsv(csv);
    expect(r.valid).toEqual([
      { email: "a@x.com", full_name: "Alice", roleText: "" },
      { email: "b@x.com", full_name: "Bob", roleText: "" },
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
    expect(r.valid[0]).toEqual({ email: "a@x.com", full_name: "Alice", roleText: "" });
  });

  it("carries the raw role_level text through as roleText (unvalidated, resolved later by the mapping step)", () => {
    const csv = "email,role_level\na@x.com,Sales Professional\nb@x.com,anything at all";
    expect(parseAgentsCsv(csv).valid.map((v) => v.roleText)).toEqual([
      "Sales Professional",
      "anything at all",
    ]);
  });

  it("trims surrounding whitespace on roleText", () => {
    const csv = "email,role_level\na@x.com,  VP of Sales  ";
    expect(parseAgentsCsv(csv).valid[0].roleText).toBe("VP of Sales");
  });

  it("roleText is empty when the column is absent or blank", () => {
    expect(parseAgentsCsv("email\na@x.com").valid[0].roleText).toBe("");
    expect(parseAgentsCsv("email,role_level\na@x.com,").valid[0].roleText).toBe("");
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
