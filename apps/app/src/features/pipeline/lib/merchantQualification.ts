/** Merchant Services qualification (FR-PIPE-08), parsed defensively out of the
 *  deals.profession_data JSONB. Returns null unless profession === "merchant_services". */
export const ACCEPTANCE_METHOD_LABELS: Record<string, string> = {
  card_present: "Card present",
  card_not_present: "Card not present",
  ecommerce: "E-commerce",
  mobile: "Mobile",
  in_app: "In-app",
};

export interface MerchantQualification {
  annualVolume?: number;
  acceptanceMethods: string[];
  currentProcessor?: string;
  currentEffectiveRate?: number;
  posTerminal?: string;
  avgTicketSize?: number;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

export function readMerchantQualification(
  data: Record<string, unknown> | null | undefined,
): MerchantQualification | null {
  if (!data || data.profession !== "merchant_services") return null;
  return {
    annualVolume: num(data.annualVolume),
    acceptanceMethods: Array.isArray(data.acceptanceMethods)
      ? (data.acceptanceMethods.filter((m) => typeof m === "string") as string[])
      : [],
    currentProcessor: str(data.currentProcessor),
    currentEffectiveRate: num(data.currentEffectiveRate),
    posTerminal: str(data.posTerminal),
    avgTicketSize: num(data.avgTicketSize),
  };
}
