/**
 * Weekly summary opt-out (FR-PORT-84), reached from the link in the summary's
 * footer. No session. Nothing changes until the partner presses the button,
 * because mail scanners and link previews open links on their own. The server
 * answers the same for any token, so this page never says whether it matched.
 * Mail providers use the one-click header instead and never load this page.
 */
import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { Button, Card } from "@/components/navigatr";
import { portalReachMessage } from "../components/PortalRetry";
import { portalApi, type PortalBrand } from "../lib/portalApi";

type State = "idle" | "busy" | "done" | "error";

export function PortalUnsubscribePage({ slug, brand }: { slug: string; brand: PortalBrand }) {
  const [params] = useSearchParams();
  const token = (params.get("t") ?? "").trim();
  const [state, setState] = React.useState<State>("idle");

  const confirm = async () => {
    setState("busy");
    try {
      await portalApi.unsubscribeDigest(slug, token);
      setState("done");
    } catch {
      setState("error");
    }
  };

  if (!token) {
    return (
      <Card padding="lg" className="flex flex-col gap-2">
        <h1 className="text-heading-lg text-text-default">This link isn&apos;t complete</h1>
        <p className="text-body-md text-text-muted">
          Open the link from your weekly summary email again, or turn the summary off in your profile.
        </p>
      </Card>
    );
  }

  if (state === "done") {
    return (
      <Card padding="lg" className="flex flex-col gap-2">
        <h1 className="text-heading-lg text-text-default">You&apos;re unsubscribed</h1>
        <p className="text-body-md text-text-muted">
          You will stop getting the weekly summary. You can turn it back on in your profile.
        </p>
      </Card>
    );
  }

  return (
    <Card padding="lg" className="flex flex-col gap-3">
      <h1 className="text-heading-lg text-text-default">Stop the weekly summary?</h1>
      <p className="text-body-md text-text-muted">
        You&apos;ll stop getting the weekly summary email from {brand.orgName}. Emails about your referrals still arrive.
      </p>
      {state === "error" && (
        <p role="alert" className="text-body-sm text-status-danger">
          {portalReachMessage(brand.orgName)}
        </p>
      )}
      <Button
        variant="primary"
        size="lg"
        fullWidth
        loading={state === "busy"}
        disabled={state === "busy"}
        onClick={() => void confirm()}
      >
        Unsubscribe
      </Button>
    </Card>
  );
}
