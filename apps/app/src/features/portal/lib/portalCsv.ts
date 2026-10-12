/**
 * CSV export of the partner's own referrals (FR-PORT-75). Built in the browser
 * from the export_referrals response, which is already an allowlist: partner
 * labels only, and a closed-won value only when the ISO shows values.
 *
 * Cells follow RFC 4180 quoting, and any cell a spreadsheet could read as a
 * formula (starting with =, +, -, @, tab or carriage return) gets a leading
 * single quote, so opening the file never runs anything.
 */
import type { PortalExport } from "./portalApi";

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function isoDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function buildReferralsCsv(data: PortalExport): string {
  const header = ["Reference", "Business", "Status", "Sent", "Last update"];
  if (data.valueVisible) header.push("Closed Won value");
  const lines = [header.map(csvCell).join(",")];
  for (const r of data.rows) {
    const cells = [r.ref, r.companyName, r.label, isoDay(r.submittedAt), isoDay(r.lastActivityAt)];
    if (data.valueVisible) cells.push(r.closedWonValueCents === null ? "" : dollars(r.closedWonValueCents));
    lines.push(cells.map(csvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function referralsCsvFilename(slug: string, now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const safeSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, "") || "portal";
  return `${safeSlug}-referrals-${date}.csv`;
}

export function downloadCsv(filename: string, csv: string): void {
  // The byte order mark makes Excel read the file as UTF-8 (accented names).
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Free it after the click is handled; some mobile browsers lose the file otherwise.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
