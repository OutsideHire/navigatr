/**
 * Parse a CSV string of agent invitations into validated rows + errors.
 *
 * Required column: email. Optional: full_name, role_level, reports_to_email.
 * Accepted role_level values: any of the 7 hierarchy levels, given EITHER by
 * its display label ("Sales Professional", "VP of Sales", "CSO / CRO", ...) OR
 * its internal code ("sales_professional", ...). Matching ignores case,
 * spacing, and punctuation, so what an admin naturally copies from the UI works
 * (a real Elavon beta file failed every row because it used the labels).
 * Defaults to "sales_professional" when absent/blank.
 * reports_to_email carries through as reports_to (an existing member's email);
 * the RPC validates it resolves — the parser does not check existence.
 *
 * Header detection is forgiving: "Email Address" / "Email" / "email" all
 * map to email; "Full Name" / "Name" / "full_name" all map to full_name.
 *
 * Pure function — no React, no Supabase. Used by the CSV import wizard.
 */
import Papa from "papaparse";
import { ROLE_LEVEL_OPTIONS, type RoleLevel } from "@/features/auth/capabilities";

// Normalize a role-level string for matching: lowercase, drop everything that
// isn't a letter or digit. This collapses "Sales Professional",
// "sales_professional", and "SALES  PROFESSIONAL" to one key, and "CSO / CRO"
// / "cso_cro" to another.
const normRoleLevel = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Look up a role level by its normalized label OR code -> the internal value.
const ROLE_LEVEL_LOOKUP = new Map<string, RoleLevel>();
for (const o of ROLE_LEVEL_OPTIONS) {
  ROLE_LEVEL_LOOKUP.set(normRoleLevel(o.value), o.value);
  ROLE_LEVEL_LOOKUP.set(normRoleLevel(o.label), o.value);
}

export interface ParsedAgent {
  email: string;
  full_name: string | null;
  role_level: RoleLevel;
  /** An existing member's email (RPC validates it resolves). Omitted when blank. */
  reports_to?: string;
}

export interface ParseError {
  /** 1-indexed row number (matches what a user sees in their spreadsheet). */
  row: number;
  reason:
    | "missing_email"
    | "invalid_email"
    | "invalid_role_level"
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

    const rawRoleLevel = (row.rolelevel ?? "").trim();
    let role_level: RoleLevel = "sales_professional";
    if (rawRoleLevel) {
      const mapped = ROLE_LEVEL_LOOKUP.get(normRoleLevel(rawRoleLevel));
      if (!mapped) {
        errors.push({ row: rowNumber, reason: "invalid_role_level", raw: rawText });
        return;
      }
      role_level = mapped;
    }

    const fullName =
      (row.fullname ?? row.name ?? "").trim() || null;

    const reports_to = (row.reportstoemail ?? "").trim() || undefined;

    seen.add(email);
    const agent: ParsedAgent = { email, full_name: fullName, role_level };
    if (reports_to) agent.reports_to = reports_to;
    valid.push(agent);
  });

  return { valid, errors };
}
