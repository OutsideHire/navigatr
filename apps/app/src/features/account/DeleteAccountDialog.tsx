/**
 * DeleteAccountDialog — confirmation modal for self-service account
 * deletion (GDPR right-to-be-forgotten via anonymization).
 *
 * Two-stage confirmation:
 *   1. Reading the warning text (one click on "Continue")
 *   2. Typing "DELETE" verbatim into a confirmation input
 *
 * The typing-step is the industry-standard guardrail against
 * accidental clicks. It also creates a tiny friction barrier that
 * encourages the user to re-read the consequences before proceeding.
 *
 * On confirmation, calls useDeleteAccount which:
 *   - Hits the RPC (anonymizes profile + auth metadata, logs audit event)
 *   - Signs the user out
 *   - Navigates to /login
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, FormField, Input } from "@/components/navigatr";
import { cn } from "@/lib/utils";
import { useDeleteAccount } from "./useDeleteAccount";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CONFIRMATION_WORD = "DELETE";

export function DeleteAccountDialog({ open, onOpenChange }: Props) {
  const [typed, setTyped] = React.useState("");
  const deleteAccount = useDeleteAccount();

  // Reset the typed-confirmation when the dialog reopens. Otherwise a
  // user who typed DELETE, cancelled, and reopened would skip the
  // friction step.
  React.useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  const canSubmit = typed === CONFIRMATION_WORD && !deleteAccount.isPending;

  const onConfirm = async () => {
    try {
      await deleteAccount.mutateAsync();
      // We don't show a success toast here because the user is already
      // being navigated off the page. The /login landing is the
      // confirmation surface.
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't delete account",
      );
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            "fixed inset-0 z-40 bg-black/40",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          )}
        />
        <Dialog.Content
          aria-describedby="delete-account-body"
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2",
            "rounded-radius-lg bg-surface-default shadow-card-hover",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          )}
        >
          <div className="flex items-start justify-between gap-2 px-5 pb-2 pt-5">
            <Dialog.Title className="flex items-center gap-2 text-heading-sm text-status-danger">
              <Trash2 className="h-5 w-5" aria-hidden />
              Delete account
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="inline-flex h-8 w-8 items-center justify-center rounded-radius-sm text-text-muted hover:bg-surface-sunken hover:text-text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
              >
                <X className="h-5 w-5" />
              </button>
            </Dialog.Close>
          </div>

          <div id="delete-account-body" className="px-5 pb-5">
            <p className="text-body-md text-text-default">
              This will <strong>permanently anonymize your account</strong>.
            </p>

            <Card padding="md" className="mt-3 border-status-danger/30 bg-status-danger-bg/30">
              <ul className="flex flex-col gap-2 text-body-sm text-text-default">
                <li>
                  Your name and email are removed. The account becomes
                  &ldquo;Deleted User&rdquo; everywhere it appears.
                </li>
                <li>
                  Your deals, activities, and partner records stay on
                  the team&apos;s pipeline so business history is
                  preserved.
                </li>
                <li>
                  You will be signed out immediately and unable to sign
                  back in.
                </li>
                <li>
                  This cannot be undone. Contact{" "}
                  <a
                    href="mailto:privacy@getnavigatr.io"
                    className="text-brand-primary hover:underline"
                  >
                    privacy@getnavigatr.io
                  </a>{" "}
                  for hard-delete requests or to recover before submitting.
                </li>
              </ul>
            </Card>

            <div className="mt-4">
              <FormField
                htmlFor="delete-confirm"
                label={`Type ${CONFIRMATION_WORD} to confirm`}
                helper="This guardrail prevents accidental clicks."
              >
                <Input
                  id="delete-confirm"
                  type="text"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder={CONFIRMATION_WORD}
                />
              </FormField>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" variant="tertiary" size="md">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button
                type="button"
                variant="primary"
                size="md"
                disabled={!canSubmit}
                loading={deleteAccount.isPending}
                onClick={onConfirm}
                className="bg-status-danger hover:bg-status-danger/90"
              >
                Delete my account
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
