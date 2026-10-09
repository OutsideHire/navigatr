/**
 * PartnerPortalTab: the admin "Partner portal" settings card (spec 5.10).
 * Turn the portal on, edit the partner terms (every change bumps the version; partners who join
 * after a change accept the new version) and the consent line, choose whether partners see
 * closed-won value, and copy the portal address.
 *
 * The form remounts whenever the saved state changes (key below), so it always
 * starts from what the server stored, including seeded starting text.
 */
import * as React from "react";
import { toast } from "sonner";
import { Copy, Loader2 } from "lucide-react";
import { Button, Card, Checkbox, FormField, Input, Textarea } from "@/components/navigatr";
import { portalAddress } from "@/features/portal/lib/portalAddress";
import { TabHeader } from "./TabHeader";
import { usePortalSettings, useUpdatePortalSettings, type PortalSettings } from "../usePortalSettings";

function formKey(s: PortalSettings): string {
  return [s.enabled, s.termsVersion, s.consentVersion, s.valueVisibility].join(":");
}

export function PartnerPortalTab() {
  const settings = usePortalSettings();
  return (
    <>
      <TabHeader
        title="Partner portal"
        subtitle="Let referral partners sign in, send you businesses, and follow each referral."
      />
      {settings.isPending ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-label="Loading" />
        </div>
      ) : settings.isError || !settings.data ? (
        <p className="text-body-md text-text-muted">We couldn&apos;t load the portal settings. Refresh to try again.</p>
      ) : (
        <PartnerPortalForm key={formKey(settings.data)} initial={settings.data} />
      )}
    </>
  );
}

function PartnerPortalForm({ initial }: { initial: PortalSettings }) {
  const update = useUpdatePortalSettings();
  const [enabled, setEnabled] = React.useState(initial.enabled);
  const [termsText, setTermsText] = React.useState(initial.termsText ?? "");
  const [consentText, setConsentText] = React.useState(initial.consentText ?? "");
  const [valueVisibility, setValueVisibility] = React.useState(initial.valueVisibility);
  const address = initial.slug ? portalAddress(initial.slug) : "";

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await update.mutateAsync({ enabled, termsText, consentText, valueVisibility });
      toast.success("Portal settings saved");
    } catch {
      toast.error("Couldn't save the portal settings. Try again.");
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      toast.success("Portal address copied");
    } catch {
      toast.error("Couldn't copy. Select the address to copy it.");
    }
  };

  const termsHelper =
    initial.termsVersion > 0
      ? `Version ${initial.termsVersion}. Partners who join after a change accept the new version.`
      : "Partners accept these before they first sign in. Leave blank to start from a draft.";

  return (
    <form onSubmit={save} className="flex flex-col gap-6" noValidate>
      <Card padding="lg" className="flex flex-col gap-5">
        <Checkbox
          variant="toggle"
          id="portal-enabled"
          checked={enabled}
          onCheckedChange={setEnabled}
          label="Turn on the partner portal"
          helper="Partners you invite can sign in at your portal address."
        />

        <div className="flex items-end gap-2">
          <FormField
            label="Portal address"
            htmlFor="portal-address"
            helper="Share it with partners you've invited."
            className="min-w-0 flex-1"
          >
            <Input id="portal-address" readOnly value={address} />
          </FormField>
          <Button
            type="button"
            variant="secondary"
            size="md"
            leadingIcon={Copy}
            disabled={!address}
            onClick={() => void copy()}
          >
            Copy
          </Button>
        </div>

        <FormField label="Partner terms" htmlFor="portal-terms" helper={termsHelper}>
          <Textarea id="portal-terms" rows={6} value={termsText} onChange={(e) => setTermsText(e.target.value)} />
        </FormField>
        <p className="-mt-3 text-caption text-text-subtle">
          Have your legal team review these terms before you invite partners.
        </p>

        <FormField
          label="Consent line"
          htmlFor="portal-consent"
          helper="Partners confirm this each time they send a referral."
        >
          <Input id="portal-consent" value={consentText} onChange={(e) => setConsentText(e.target.value)} />
        </FormField>

        <Checkbox
          variant="toggle"
          id="portal-value-visibility"
          checked={valueVisibility}
          onCheckedChange={setValueVisibility}
          label="Show closed-won value to partners"
          helper="When off, partners see that a referral closed, but not its value."
        />
      </Card>

      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="md" loading={update.isPending}>
          Save
        </Button>
      </div>
    </form>
  );
}
