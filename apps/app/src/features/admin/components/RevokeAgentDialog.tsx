/**
 * RevokeAgentDialog — replaces the plain window.confirm for the
 * "Deactivate agent" action. If the agent has open deals, the admin can
 * choose to reassign them to another active team member before deactivating.
 *
 * Used only for kind='profile'. Invite revocation stays as a plain confirm.
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button, Select, type SelectOption } from "@/components/navigatr";
import { useReassignDeals } from "../hooks/useReassignDeals";
import { useRevokeMember } from "../hooks/useRevokeMember";
import type { LeaderboardRow } from "../hooks/useTeamLeaderboard";

export interface RevokeAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The agent being deactivated. */
  agent: LeaderboardRow;
  /** All active rows from the leaderboard (used to build successor list). */
  activeAgents: LeaderboardRow[];
}

export function RevokeAgentDialog({
  open,
  onOpenChange,
  agent,
  activeAgents,
}: RevokeAgentDialogProps) {
  const reassign = useReassignDeals();
  const revoke = useRevokeMember();

  // "reassign" | "leave" — only relevant when agent has open deals
  const [dealChoice, setDealChoice] = React.useState<"reassign" | "leave">("reassign");
  const [successorId, setSuccessorId] = React.useState<string>("");
  const [submitting, setSubmitting] = React.useState(false);

  const openDealCount = agent.open_deals;
  const hasOpenDeals = openDealCount > 0;

  // Successor options: all OTHER active profiles in the org
  const successorOptions: SelectOption[] = activeAgents
    .filter((r) => r.agent_id !== agent.agent_id && r.status === "active")
    .map((r) => ({
      value: r.agent_id,
      label: r.full_name ?? r.email,
    }));

  // Reset choice state when dialog opens for a new agent
  React.useEffect(() => {
    if (open) {
      setDealChoice("reassign");
      setSuccessorId(successorOptions[0]?.value ?? "");
      setSubmitting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agent.agent_id]);

  const displayName = agent.full_name ?? agent.email;

  const pipelineDisplay = React.useMemo(() => {
    if (openDealCount === 0) return null;
    const dollars = (agent.pipeline_cents / 100).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
    return `${openDealCount} open ${openDealCount === 1 ? "deal" : "deals"} (${dollars})`;
  }, [openDealCount, agent.pipeline_cents]);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      let reassignedCount = 0;
      if (hasOpenDeals && dealChoice === "reassign" && successorId) {
        reassignedCount = await reassign.mutateAsync({
          fromProfile: agent.agent_id,
          toProfile: successorId,
        });
      }
      await revoke.mutateAsync({ targetId: agent.agent_id, kind: "profile" });

      if (reassignedCount > 0) {
        const successor = successorOptions.find((o) => o.value === successorId);
        toast.success(
          `Deactivated ${displayName}. ${reassignedCount} ${reassignedCount === 1 ? "deal" : "deals"} reassigned to ${successor?.label ?? "successor"}.`,
        );
      } else {
        toast.success(`Deactivated ${displayName}.`);
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not deactivate agent");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby="revoke-dialog-desc"
          className={cn(
            "fixed z-50 flex flex-col bg-surface-default shadow-card-hover",
            "inset-x-0 bottom-0 max-h-[90dvh] rounded-t-radius-lg",
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-radius-lg",
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4">
            <Dialog.Title className="text-heading-sm">
              Deactivate {displayName}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="h-8 w-8 rounded text-text-muted hover:bg-surface-sunken"
              >
                <X className="h-5 w-5 mx-auto" />
              </button>
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="flex flex-col gap-4 px-5 pb-5">
            {hasOpenDeals ? (
              <>
                <p id="revoke-dialog-desc" className="text-body-md text-text-default">
                  {displayName} has {pipelineDisplay}. What do you want to do with them?
                </p>

                {/* Reassign option */}
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    name="deal-choice"
                    value="reassign"
                    checked={dealChoice === "reassign"}
                    onChange={() => setDealChoice("reassign")}
                    className="mt-1 accent-brand-primary"
                  />
                  <div className="flex flex-1 flex-col gap-2">
                    <span className="text-body-md text-text-default">Reassign to:</span>
                    {dealChoice === "reassign" && (
                      <Select
                        options={successorOptions}
                        value={successorId}
                        onValueChange={setSuccessorId}
                        placeholder="Pick a successor…"
                        disabled={successorOptions.length === 0}
                      />
                    )}
                    {dealChoice === "reassign" && successorOptions.length === 0 && (
                      <p className="text-caption text-status-danger">
                        No other active agents in this org.
                      </p>
                    )}
                  </div>
                </label>

                {/* Leave attached option */}
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    name="deal-choice"
                    value="leave"
                    checked={dealChoice === "leave"}
                    onChange={() => setDealChoice("leave")}
                    className="mt-1 accent-brand-primary"
                  />
                  <div className="flex flex-col">
                    <span className="text-body-md text-text-default">Leave attached</span>
                    <span className="text-caption text-text-muted">
                      Deals stay with {displayName} — you&rsquo;ll still see them as a
                      manager but no one will work them.
                    </span>
                  </div>
                </label>
              </>
            ) : (
              <p id="revoke-dialog-desc" className="text-body-md text-text-default">
                Deactivate {displayName}? They&rsquo;ll no longer be able to sign in.
                (Their closed deals stay attached for audit.)
              </p>
            )}

            {/* Actions */}
            <div className="mt-2 flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" variant="tertiary" size="md">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button
                type="button"
                variant="primary"
                size="md"
                loading={submitting}
                disabled={
                  submitting ||
                  (hasOpenDeals && dealChoice === "reassign" && !successorId)
                }
                onClick={handleConfirm}
              >
                Deactivate agent
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
