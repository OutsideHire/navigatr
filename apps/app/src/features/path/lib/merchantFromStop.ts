/**
 * merchantFromStop — adapt a TodayStop snapshot to the Merchant shape DropInSheet
 * expects. Running mode only has the snapshot (no live prospect join); DropInSheet
 * reads name/address/category/phone/id. The enrichment fields Merchant carries
 * (email/employees/etc.) aren't available here — set safe defaults.
 */
import type { Merchant, MerchantCategory } from "../mockData";
import type { TodayStop } from "../hooks/useTodayPath";

export function merchantFromStop(stop: TodayStop): Merchant {
  return {
    id: stop.merchantId,
    name: stop.name,
    category: stop.category as MerchantCategory,
    address: stop.address ?? "",
    lat: stop.lat,
    lng: stop.lng,
    phone: stop.phone ?? "",
    employeeCountRange: "",
    status: "untouched",
    lastActivity: null,
    primaryType: stop.primaryType,
  };
}
