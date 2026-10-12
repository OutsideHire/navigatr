/** Display helpers for the partner portal (short, phone-friendly). */
export function formatPortalDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatPortalMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    cents / 100,
  );
}

export function formatConversion(rate: number | null): string {
  return rate === null ? "No closed referrals yet" : `${Math.round(rate * 100)}%`;
}
