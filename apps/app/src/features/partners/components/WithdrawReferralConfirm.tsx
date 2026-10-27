/**
 * Confirm step for "Withdraw (partner asked)" (FR-PORT-42). Shared by the review
 * sheet and the deal page. The note is internal only; the partner just sees
 * Withdrawn.
 */
import * as React from "react";
import { toast } from "sonner";
import { Button, NotesFieldWithMic } from "@/components/navigatr";
import { useWithdrawReferral } from "../hooks/useReferralMutations";

export interface WithdrawReferralConfirmProps {
  referralId: string;
  onBack: () => void;
  onDone: () => void;
}

export function WithdrawReferralConfirm({ referralId, onBack, onDone }: WithdrawReferralConfirmProps) {
  const withdraw = useWithdrawReferral();
  const [note, setNote] = React.useState("");

  const onConfirm = async () => {
    try {
      await withdraw.mutateAsync({ referralId, note });
      toast.success("Referral withdrawn. The partner will see Withdrawn.");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-body-sm text-text-muted">
        Use this when the partner asked you to pull the referral. They will see it as Withdrawn. Your note is internal only.
      </p>
      <NotesFieldWithMic value={note} onChange={setNote} placeholder="Internal note (optional)" />
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onBack}>Back</Button>
        <Button
          variant="primary"
          className="flex-1"
          disabled={withdraw.isPending}
          loading={withdraw.isPending}
          onClick={onConfirm}
        >
          Withdraw referral
        </Button>
      </div>
    </div>
  );
}
