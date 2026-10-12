/**
 * PortalProfilePage (FR-PORT-19): the partner keeps their name and phone current
 * and chooses whether to get the weekly email. The sign-in email is their
 * identity, so it shows here but cannot be changed: their contact at the ISO
 * changes it on the partner record. Name and phone changes update the ISO's
 * partner record and show on its partner page.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Loader2 } from "lucide-react";
import { Button, Card, Checkbox, FormField, Input } from "@/components/navigatr";
import { PortalRetry, portalReachMessage } from "../components/PortalRetry";
import {
  PortalApiError,
  isPortalTransientError,
  isPortalUnauthorized,
  portalApi,
  portalDataKey,
  type PortalProfile,
} from "../lib/portalApi";
import { usePortalSignedIn } from "../lib/portalSignedIn";
import {
  PORTAL_PROFILE_LIMITS,
  PORTAL_PROFILE_MESSAGES,
  validateProfile,
  type PortalProfileField,
} from "../../../../../../supabase/functions/_shared/portalProfile";

export function PortalProfilePage() {
  const { slug, token, brand, expire } = usePortalSignedIn();
  const profile = useQuery({
    queryKey: portalDataKey(slug, token, "profile"),
    queryFn: () => portalApi.getProfile(slug, token),
    retry: false,
  });

  const unauthorized = isPortalUnauthorized(profile.error);
  React.useEffect(() => {
    if (unauthorized) expire();
  }, [unauthorized, expire]);

  if (unauthorized || profile.isPending) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-label="Loading" />
      </div>
    );
  }
  if (!profile.data) {
    return <PortalRetry name={brand.orgName} busy={profile.isFetching} onRetry={() => void profile.refetch()} />;
  }
  return <ProfileForm initial={profile.data} />;
}

function ProfileForm({ initial }: { initial: PortalProfile }) {
  const { slug, token, brand, expire } = usePortalSignedIn();
  const queryClient = useQueryClient();
  const [name, setName] = React.useState(initial.name);
  const [phone, setPhone] = React.useState(initial.phone ?? "");
  const [digest, setDigest] = React.useState(initial.weeklyDigest);
  const [field, setField] = React.useState<PortalProfileField | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(false);
    setNotice(null);
    const check = validateProfile({ name, phone, weeklyDigest: digest });
    if (!check.ok) {
      setField(check.field);
      return;
    }
    setField(null);
    setBusy(true);
    try {
      const next = await portalApi.updateProfile(slug, token, check.value);
      queryClient.setQueryData(portalDataKey(slug, token, "profile"), next);
      // The top bar shows the partner's name.
      void queryClient.invalidateQueries({ queryKey: ["portal", "me", slug] });
      setName(next.name);
      setPhone(next.phone ?? "");
      setDigest(next.weeklyDigest);
      setSaved(true);
    } catch (err) {
      if (isPortalUnauthorized(err)) {
        expire();
        return;
      }
      if (err instanceof PortalApiError && err.code === "invalid_body" && (err.field === "name" || err.field === "phone")) {
        setField(err.field);
      } else if (err instanceof PortalApiError && err.code === "rate_limited") {
        setNotice("Too many changes in a short time. Try again in an hour.");
      } else if (isPortalTransientError(err)) {
        setNotice(portalReachMessage(brand.orgName));
      } else {
        setNotice("We couldn't save your changes. Try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Link
        to={`/p/${slug}/home`}
        className="inline-flex min-h-11 items-center gap-1 self-start text-body-sm text-brand-primary"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        Back to your referrals
      </Link>

      <Card padding="lg">
        <form noValidate onSubmit={(e) => void save(e)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-heading-lg text-text-default">Your profile</h1>
            <p className="text-body-md text-text-muted">
              {brand.orgName} uses these details to reach you about your referrals.
            </p>
          </div>

          <FormField
            label="Your name"
            htmlFor="portal-profile-name"
            error={field === "name" ? PORTAL_PROFILE_MESSAGES.name : undefined}
          >
            <Input
              id="portal-profile-name"
              autoComplete="name"
              maxLength={PORTAL_PROFILE_LIMITS.name}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>

          <FormField
            label="Phone (optional)"
            htmlFor="portal-profile-phone"
            error={field === "phone" ? PORTAL_PROFILE_MESSAGES.phone : undefined}
          >
            <Input
              id="portal-profile-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={PORTAL_PROFILE_LIMITS.phone}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </FormField>

          <div className="flex flex-col gap-1">
            <span className="text-label text-text-default">Sign-in email</span>
            <span className="break-all text-body-md text-text-default">{initial.email}</span>
            <span className="text-caption text-text-muted">To change it, ask your contact at {brand.orgName}.</span>
          </div>

          <div className="flex min-h-11 items-center">
            <Checkbox
              id="portal-profile-digest"
              checked={digest}
              onCheckedChange={setDigest}
              label="Weekly email about my referrals"
              helper="A short summary once a week. You can turn it off any time."
            />
          </div>

          {notice && (
            <p role="alert" className="text-body-sm text-status-danger">
              {notice}
            </p>
          )}
          {saved && (
            <p role="status" className="text-body-sm text-text-muted">
              Saved.
            </p>
          )}

          <Button type="submit" variant="primary" size="lg" fullWidth loading={busy} disabled={busy}>
            Save changes
          </Button>
        </form>
      </Card>
    </div>
  );
}
