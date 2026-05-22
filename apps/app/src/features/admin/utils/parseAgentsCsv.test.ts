import { describe, it, expect } from "vitest";
import { parseAgentsCsv } from "./parseAgentsCsv";

describe("parseAgentsCsv", () => {
  it("parses a simple two-row CSV", () => {
    const csv = "email,full_name\na@x.com,Alice\nb@x.com,Bob";
    const r = parseAgentsCsv(csv);
    expect(r.valid).toEqual([
      { email: "a@x.com", full_name: "Alice", role: "rep" },
      { email: "b@x.com", full_name: "Bob", role: "rep" },
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
    expect(r.valid[0]).toEqual({ email: "a@x.com", full_name: "Alice", role: "rep" });
  });

  it("defaults role to 'rep' when not provided", () => {
    const csv = "email\na@x.com";
    expect(parseAgentsCsv(csv).valid[0].role).toBe("rep");
  });

  it("accepts role values 'rep' / 'manager' (case-insensitive)", () => {
    const csv = "email,role\na@x.com,MANAGER\nb@x.com,rep";
    expect(parseAgentsCsv(csv).valid.map((v) => v.role)).toEqual(["manager", "rep"]);
  });

  it("rejects unknown role values", () => {
    const csv = "email,role\na@x.com,godmode";
    const r = parseAgentsCsv(csv);
    expect(r.valid).toEqual([]);
    expect(r.errors[0].reason).toBe("invalid_role");
  });

  it("dedupes within the file (keeps first, errors subsequent)", () => {
    const csv = "email\na@x.com\nA@X.com";
    const r = parseAgentsCsv(csv);
    expect(r.valid).toHaveLength(1);
    expect(r.errors[0].reason).toBe("duplicate_in_file");
  });
});
