import { describe, it, expect, vi, afterEach } from "vitest";
import { buildReferralsCsv, csvCell, downloadCsv, referralsCsvFilename } from "./portalCsv";
import type { PortalExportRow } from "./portalApi";

const ROW: PortalExportRow = {
  ref: "REF-AAAA0001",
  companyName: "Fresh Bakery",
  label: "Closed Won",
  submittedAt: "2026-10-01T12:00:00Z",
  lastActivityAt: "2026-10-05T12:00:00Z",
  closedWonValueCents: 500000,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("csvCell", () => {
  it("leaves plain text alone", () => {
    expect(csvCell("Fresh Bakery")).toBe("Fresh Bakery");
  });

  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell("Smith, Jones & Co")).toBe('"Smith, Jones & Co"');
    expect(csvCell('The "Best" Deli')).toBe('"The ""Best"" Deli"');
    expect(csvCell("Line one\nLine two")).toBe('"Line one\nLine two"');
  });

  it("defuses anything a spreadsheet would run as a formula", () => {
    for (const bad of ['=HYPERLINK("http://x")', "+1+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"]) {
      expect(csvCell(bad).replace(/^"/, "").startsWith("'")).toBe(true);
    }
    expect(csvCell("=1,2")).toBe(`"'=1,2"`);
  });
});

describe("buildReferralsCsv", () => {
  it("writes the partner's rows without a value column when the ISO hides values", () => {
    expect(buildReferralsCsv({ valueVisible: false, rows: [{ ...ROW, closedWonValueCents: null }] })).toBe(
      "Reference,Business,Status,Sent,Last update\r\nREF-AAAA0001,Fresh Bakery,Closed Won,2026-10-01,2026-10-05\r\n",
    );
  });

  it("adds the closed won value in dollars when the ISO shows values", () => {
    const csv = buildReferralsCsv({
      valueVisible: true,
      rows: [ROW, { ...ROW, ref: "REF-AAAA0002", companyName: "Corner Cafe", label: "In Progress", closedWonValueCents: null }],
    });
    expect(csv).toBe(
      "Reference,Business,Status,Sent,Last update,Closed Won value\r\n" +
        "REF-AAAA0001,Fresh Bakery,Closed Won,2026-10-01,2026-10-05,5000.00\r\n" +
        "REF-AAAA0002,Corner Cafe,In Progress,2026-10-01,2026-10-05,\r\n",
    );
  });

  it("writes only the header when there is nothing to export, and defuses hostile names", () => {
    expect(buildReferralsCsv({ valueVisible: false, rows: [] })).toBe("Reference,Business,Status,Sent,Last update\r\n");
    const csv = buildReferralsCsv({ valueVisible: false, rows: [{ ...ROW, companyName: "=cmd|' /C calc'!A0", closedWonValueCents: null }] });
    expect(csv).toContain(",'=cmd|' /C calc'!A0,");
  });
});

describe("referralsCsvFilename", () => {
  it("names the file after the ISO's portal and today's date", () => {
    expect(referralsCsvFilename("acme", new Date(2026, 9, 16, 9, 30))).toBe("acme-referrals-2026-10-16.csv");
    expect(referralsCsvFilename("Bad Slug/../x", new Date(2026, 0, 5))).toBe("badslugx-referrals-2026-01-05.csv");
    expect(referralsCsvFilename("", new Date(2026, 0, 5))).toBe("portal-referrals-2026-01-05.csv");
  });
});

describe("downloadCsv", () => {
  it("hands the browser a UTF-8 CSV with the given name and frees it afterwards", () => {
    vi.useFakeTimers();
    const create = vi.fn((_blob: Blob) => "blob:csv-1");
    const revoke = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { value: create, configurable: true, writable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revoke, configurable: true, writable: true });
    const click = vi.spyOn(HTMLElement.prototype, "click").mockImplementation(() => {});

    downloadCsv("acme-referrals-2026-10-16.csv", "a,b\r\n");

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].type).toBe("text/csv;charset=utf-8");
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("acme-referrals-2026-10-16.csv");
    expect(anchor.href).toBe("blob:csv-1");
    expect(document.querySelector("a[download]")).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith("blob:csv-1");
  });
});
