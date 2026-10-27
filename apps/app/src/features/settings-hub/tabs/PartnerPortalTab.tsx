/**
 * PartnerPortalTab: the admin "Partner portal" settings card (spec 5.10).
 * Turn the portal on, edit the partner terms (every change bumps the version; partners accept
 * the new version at their next sign-in, FR-PORT-18) and the consent line, choose whether partners see
 * closed-won value, and copy the portal address.
 *
 * The form remounts whenever the saved state changes (key below), so it always
 * starts from what the server stored, including seeded starting text. A save
 * also resets the fields from what the server returned: blank terms or consent
 * means "keep", so the saved row can equal the old one and leave the key as is.
 */
import * as React from "react";
import { toast } from "sonner";
import { Copy, Loader2 } from "lucide-react";
import { Button, Card, Checkbox, FormField, Input, Textarea } from "@/components/navigatr";
import { portalAddress } from "@/features/portal/lib/portalAddress";
import { TabHeader } from "./TabHeader";
import {
  usePortalSettings,
  useSetPublicFormEnabled,
  useUpdatePortalSettings,
  type PortalSettings,
} from "../usePortalSettings";

function formKey(s: PortalSettings): string {
  return JSON.stringify([s.enabled, s.termsVersion, s.consentVersion, s.valueVisibility, s.termsText, s.consentText]);
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
        <>
          <PartnerPortalForm key={formKey(settings.data)} initial={settings.data} />
          <PublicFormCard settings={settings.data} />
        </>
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
      const saved = await update.mutateAsync({ enabled, termsText, consentText, valueVisibility });
      setEnabled(saved.enabled);
      setTermsText(saved.termsText ?? "");
      setConsentText(saved.consentText ?? "");
      setValueVisibility(saved.valueVisibility);
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
      ? `Version ${initial.termsVersion}. Partners accept the new version at their next sign-in.`
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

/**
 * The public referral form switch (FR-PORT-28). Saves on flip. It can only be
 * turned on while the saved portal setting is on; turning the portal off keeps
 * the stored value but closes the form (the server checks both). An
 * administrator can always turn it off, even while the portal is off.
 */
function PublicFormCard({ settings }: { settings: PortalSettings }) {
  const setPublicForm = useSetPublicFormEnabled();
  const portalOff = !settings.enabled;
  const formOn = settings.publicFormEnabled;
  const toggle = async (next: boolean) => {
    try {
      await setPublicForm.mutateAsync(next);
      toast.success(next ? "Public referral form is on" : "Public referral form is off");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't change the public referral form. Try again.");
    }
  };
  return (
    <Card padding="lg" className="mt-6 flex flex-col gap-3">
      <Checkbox
        variant="toggle"
        id="public-form-enabled"
        checked={settings.publicFormEnabled}
        disabled={(portalOff && !formOn) || setPublicForm.isPending}
        onCheckedChange={(next) => void toggle(next)}
        label="Public referral form"
        helper="Anyone with a rep's link or the company link can send you a referral without signing in. Submissions land in Referrals to review."
      />
      {portalOff && (
        <p className="text-caption text-text-subtle">
          {formOn
            ? "The portal is off, so the form is closed. You can still turn this off."
            : "Turn on the partner portal and save to use the public form."}
        </p>
      )}
    </Card>
  );
}
