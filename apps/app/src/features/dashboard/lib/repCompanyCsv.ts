/**
 * CSV export for the Activities by Sales Rep and Company report. One flat file:
 * a row per rep by company, then a Grand Total row. Pure string builder so it is
 * unit-tested; the component wraps the result in a Blob download.
 */
import type { RepActivity, RcaCounts } from "./repCompanyActivity";

const HEADER = ["Rep", "Company", "Calls", "Emails", "Visits", "Appointments", "Total"];

const FORMULA_TRIGGERS = /^[=+\-@\t\r]/;

/**
 * Make a string cell safe for CSV. Two concerns:
 * 1. Formula injection: a value starting with =, +, -, @ (or tab/CR) can run as
 *    a formula when opened in Excel/Sheets. Prefix a single quote to neutralize.
 * 2. RFC 4180 quoting: wrap in quotes (doubling internal quotes) when the value
 *    contains a comma, quote, CR, or LF.
 */
export function escapeCsvCell(value: string): string {
  const safe = FORMULA_TRIGGERS.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function row(cells: (string | number)[]): string {
  return cells.map((c) => (typeof c === "number" ? String(c) : escapeCsvCell(c))).join(",");
}

export function repCompanyCsv(
  reps: RepActivity[],
  nameOf: (ownerId: string | null) => string,
  grandTotal: RcaCounts,
): string {
  const lines = [HEADER.join(",")];
  for (const rep of reps) {
    const name = nameOf(rep.ownerId);
    for (const c of rep.companies) {
      lines.push(
        row([name, c.companyName, c.counts.call, c.counts.email, c.counts.drop_in, c.counts.appointment, c.counts.total]),
      );
    }
  }
  lines.push(
    row(["Grand total", "", grandTotal.call, grandTotal.email, grandTotal.drop_in, grandTotal.appointment, grandTotal.total]),
  );
  return lines.join("\n");
}
