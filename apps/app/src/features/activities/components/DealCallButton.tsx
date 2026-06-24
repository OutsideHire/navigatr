/**
 * DealCallButton — click-to-call for a deal that also records a dial signal
 * for Activity Logging Coverage (SP0). Wraps the presentational
 * PhoneWithClickToCall: on tap it fires useRecordDial (best-effort) then
 * launches the tel: call itself (passing onCallClick suppresses the
 * component's built-in launch). The dial is always attributed to the deal,
 * even when dialing a specific contact's number.
 */

import { PhoneWithClickToCall, type PhoneSize } from "@/components/navigatr";
import { useRecordDial } from "../hooks/useRecordDial";

export interface DealCallButtonProps {
  dealId: string;
  phoneNumber: string;
  size?: PhoneSize;
}

export function DealCallButton({ dealId, phoneNumber, size = "sm" }: DealCallButtonProps) {
  const { mutate: recordDial } = useRecordDial();
  return (
    <PhoneWithClickToCall
      phoneNumber={phoneNumber}
      size={size}
      onCallClick={(num) => {
        recordDial({ dealId, phoneNumber: num });
        if (typeof window !== "undefined") window.location.assign(`tel:${num}`);
      }}
    />
  );
}
