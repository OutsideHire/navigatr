/**
 * Parse a CSV string of agent invitations into validated rows + errors.
 *
 * Required column: email. Optional: full_name, role.
 * Accepted role values: "rep" (default), "manager". Case-insensitive.
 *
 * Header detection is forgiving: "Email Address" / "Email" / "email" all
 * map to email; "Full Name" / "Name" / "full_name" all map to full_name.
 *
 * Pure function — no React, no Supabase. Used by the CSV import wizard.
 */
import Papa from "papaparse";

export interface ParsedAgent {
  email: string;
  full_name: string | null;
  role: "rep" | "manager";
}

export interface ParseError {
  /** 1-indexed row number (matches what a user sees in their spreadsheet). */
  row: number;
  reason:
    | "missing_email"
    | "invalid_email"
    | "invalid_role"
    | "duplicate_in_file";
  raw: string;
}

export interface ParseResult {
  valid: ParsedAgent[];
  errors: ParseError[];
}

// Forgiving column-name lookup. Lowercase + strip non-alphanumeric.
const normalizeHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function parseAgentsCsv(csv: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: normalizeHeader,
  });

  const valid: ParsedAgent[] = [];
  const errors: ParseError[] = [];
  const seen = new Set<string>();

  parsed.data.forEach((row, i) => {
    // +2 because: +1 for the header row, +1 because user-facing rows are 1-indexed.
    const rowNumber = i + 2;
    const rawText = Object.values(row).join(",");
    const email = (row.email ?? row.emailaddress ?? "").trim().toLowerCase();
    if (!email) {
      errors.push({ row: rowNumber, reason: "missing_email", raw: rawText });
      return;
    }
    if (!EMAIL_RE.test(email)) {
      errors.push({ row: rowNumber, reason: "invalid_email", raw: rawText });
      return;
    }
    if (seen.has(email)) {
      errors.push({ row: rowNumber, reason: "duplicate_in_file", raw: rawText });
      return;
    }

    const rawRole = (row.role ?? "rep").trim().toLowerCase();
    if (rawRole !== "rep" && rawRole !== "manager") {
      errors.push({ row: rowNumber, reason: "invalid_role", raw: rawText });
      return;
    }
    const role = rawRole as ParsedAgent["role"];

    const fullName =
      (row.fullname ?? row.name ?? "").trim() || null;

    seen.add(email);
    valid.push({ email, full_name: fullName, role });
  });

  return { valid, errors };
}
