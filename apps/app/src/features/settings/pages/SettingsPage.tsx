/**
 * Settings — Session 20.
 *
 * Single-column scroll with sectioned Cards. Each Card has a heading,
 * optional description, and the relevant controls. Same layout
 * scale as the other authenticated pages (max-w-5xl + gap-4).
 *
 * Sections:
 *   1. Profile        — full name editable, email read-only
 *   2. Profession     — 3-tile picker, drives the AddDealSheet's
 *                       qualification branch on /pipeline + the
 *                       dashboard's hero copy
 *   3. Appearance     — light / dark / system theme radio
 *   4. Notifications  — placeholder toggles (Sprint 2 wires actual
 *                       email/push backend)
 *   5. Team           — admin-only placeholder
 *   6. Account        — sign-out + delete-account stub
 *
 * The Profile name edit calls supabase.auth.updateUser via the auth
 * store's signOut/setProfession pattern. The profession picker
 * reuses setProfession from the same store. Theme uses useTheme.
 */

import * as React from "react";
import {
  CalendarClock,
  Check,
  Copy,
  CreditCard,
  Landmark,
  Link2,
  LogOut,
  Moon,
  Monitor,
  Sun,
  Trash2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button, Card, Checkbox, FormField, Input } from "@/components/navigatr";
import {
  canInviteTeam,
  getFullName,
  getProfession,
  useAuth,
  type Profession,
} from "@/stores/auth";
import { useTheme, type Theme } from "@/stores/theme";
import { supabase } from "@/lib/supabase";
import { useOrganization } from "@/features/auth/useOrganization";

// ── Profile ──────────────────────────────────────────────────────────

function ProfileSection() {
  const user = useAuth((s) => s.user);
  const initialName = getFullName(user);
  const [name, setName] = React.useState(initialName);
  const [saving, setSaving] = React.useState(false);

  // Keep input in sync if `user` updates from another source (e.g.
  // OAuth profile refresh) and the local edit hasn't diverged.
  React.useEffect(() => {
    setName(initialName);
  }, [initialName]);

  const dirty = name.trim() !== initialName && name.trim().length > 0;

  const onSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: { full_name: name.trim() },
      });
      if (error) throw error;
      toast.success("Name updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save name");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card padding="md">
      <h2 className="mb-1 text-body-strong text-text-default">Profile</h2>
      <p className="mb-4 text-caption text-text-muted">
        How you appear across navigatr.
      </p>
      <div className="flex flex-col gap-3">
        <FormField htmlFor="profile-name" label="Full name">
          <Input
            id="profile-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jamie Rivera"
          />
        </FormField>
        <FormField htmlFor="profile-email" label="Work email" helper="Email is tied to your account and cannot be changed here.">
          <Input id="profile-email" type="email" value={user?.email ?? ""} disabled />
        </FormField>
        <div className="flex justify-end">
          <Button variant="primary" size="sm" disabled={!dirty} loading={saving} onClick={onSave}>
            Save name
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ── Profession ───────────────────────────────────────────────────────

interface ProfessionOption {
  value: Profession;
  label: string;
  description: string;
  Icon: typeof CreditCard;
  accent: string;
}

const PROFESSION_OPTIONS: ProfessionOption[] = [
  {
    value: "payroll",
    label: "Payroll",
    description: "Payroll, HR, benefits, time & attendance.",
    Icon: CalendarClock,
    accent: "bg-accent-orange-20 text-accent-orange",
  },
  {
    value: "merchant_services",
    label: "Merchant Services",
    description: "Payment processing, terminals, ISVs.",
    Icon: CreditCard,
    accent: "bg-accent-teal-20 text-accent-teal",
  },
  {
    value: "treasury_management",
    label: "Treasury Management",
    description: "Banking, treasury, cash management.",
    Icon: Landmark,
    accent: "bg-accent-blue-20 text-accent-blue",
  },
];

function ProfessionSection() {
  const user = useAuth((s) => s.user);
  const current = getProfession(user);
  const setProfession = useAuth((s) => s.setProfession);
  const [saving, setSaving] = React.useState<Profession | null>(null);

  const onPick = async (next: Profession) => {
    if (next === current || saving) return;
    setSaving(next);
    try {
      await setProfession(next);
      toast.success(`Switched to ${PROFESSION_OPTIONS.find((o) => o.value === next)?.label}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't switch profession");
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card padding="md">
      <h2 className="mb-1 text-body-strong text-text-default">Industry</h2>
      <p className="mb-4 text-caption text-text-muted">
        Drives the qualification fields, KPI defaults, and ICP filter.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {PROFESSION_OPTIONS.map((opt) => {
          const isActive = current === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onPick(opt.value)}
              aria-pressed={isActive}
              disabled={saving !== null && saving !== opt.value}
              className={cn(
                "group relative flex flex-col gap-3 rounded-radius-md border bg-surface-elevated p-4 text-left transition-all",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-default",
                "disabled:cursor-not-allowed disabled:opacity-60",
                isActive
                  ? "border-brand-primary shadow-sm ring-2 ring-brand-primary/30"
                  : "border-border-subtle hover:border-border-default",
              )}
            >
              <div className="flex items-start justify-between">
                <span className={cn("flex h-9 w-9 items-center justify-center rounded-radius-md", opt.accent)}>
                  <opt.Icon className="h-4 w-4" />
                </span>
                {isActive && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-radius-full bg-brand-primary text-brand-primary-foreground">
                    <Check className="h-3 w-3" aria-hidden />
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-body-strong text-text-default">{opt.label}</span>
                <span className="text-caption text-text-muted">{opt.description}</span>
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// ── Appearance / Theme ───────────────────────────────────────────────

interface ThemeOption {
  value: Theme;
  label: string;
  Icon: typeof Sun;
}
const THEME_OPTIONS: ThemeOption[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

function AppearanceSection() {
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);

  return (
    <Card padding="md">
      <h2 className="mb-1 text-body-strong text-text-default">Appearance</h2>
      <p className="mb-4 text-caption text-text-muted">
        Choose your theme. System follows your OS preference.
      </p>
      <div
        role="radiogroup"
        aria-label="Theme"
        className="flex flex-wrap gap-2"
      >
        {THEME_OPTIONS.map((opt) => {
          const isActive = theme === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => setTheme(opt.value)}
              className={cn(
                "inline-flex items-center gap-2 rounded-radius-md border px-3 py-2 text-body-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-default",
                isActive
                  ? "border-brand-primary bg-brand-primary-10 text-brand-primary"
                  : "border-border-subtle bg-surface-default text-text-default hover:bg-surface-sunken",
              )}
            >
              <opt.Icon className="h-4 w-4" aria-hidden />
              {opt.label}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// ── Notifications (placeholder) ──────────────────────────────────────

function NotificationsSection() {
  // Local state only — Sprint 2 wires actual notification preferences
  // to a NotificationsService and the device push token.
  const [emailDigest, setEmailDigest] = React.useState(true);
  const [emailUrgent, setEmailUrgent] = React.useState(true);
  const [pushDropIn, setPushDropIn] = React.useState(true);
  const [pushFollowup, setPushFollowup] = React.useState(false);

  return (
    <Card padding="md">
      <h2 className="mb-1 text-body-strong text-text-default">Notifications</h2>
      <p className="mb-4 text-caption text-text-muted">
        Choose what you want to hear about. <span className="text-text-subtle">Backend wires in Sprint 2.</span>
      </p>
      <div className="flex flex-col gap-3">
        <Checkbox
          id="notif-email-digest"
          label="Daily email digest"
          helper="Morning summary: today's tasks, overdue follow-ups, new partners."
          checked={emailDigest}
          onCheckedChange={setEmailDigest}
        />
        <Checkbox
          id="notif-email-urgent"
          label="Urgent email alerts"
          helper="High-value deal stalled, smart follow-up missed."
          checked={emailUrgent}
          onCheckedChange={setEmailUrgent}
        />
        <Checkbox
          id="notif-push-dropin"
          label="Push: nearby drop-in opportunity"
          helper="When Path discovers a high-ICP merchant within 0.5 mi."
          checked={pushDropIn}
          onCheckedChange={setPushDropIn}
        />
        <Checkbox
          id="notif-push-followup"
          label="Push: follow-up reminder"
          helper="15 minutes before a scheduled next-touch."
          checked={pushFollowup}
          onCheckedChange={setPushFollowup}
        />
      </div>
    </Card>
  );
}

// ── Team (admin only) ────────────────────────────────────────────────

function TeamSection() {
  const org = useOrganization();
  const [copied, setCopied] = React.useState<"link" | "code" | null>(null);

  // The invite link points new teammates at /signup?code=<invite_code>.
  // The signup form pre-fills the code so they only need to type their
  // name/email/password (or click Continue with Google). Using window.
  // location.origin works for both dev (localhost:5173) and prod (the
  // Vercel URL) — no env vars needed.
  const inviteLink = org.data
    ? `${window.location.origin}/signup?code=${encodeURIComponent(org.data.inviteCode)}`
    : null;

  const copyToClipboard = async (value: string, kind: "link" | "code") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      toast.success(kind === "link" ? "Invite link copied" : "Invite code copied");
      // Auto-clear the visual confirmation after a moment so the icon
      // doesn't stick as a checkmark forever.
      setTimeout(() => setCopied(null), 2000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't copy to clipboard");
    }
  };

  return (
    <Card padding="md">
      <h2 className="mb-1 text-body-strong text-text-default">Team</h2>
      <p className="mb-4 text-caption text-text-muted">
        Invite teammates to {org.data?.name ?? "your team"}. They&apos;ll join the same workspace.
      </p>

      {org.isLoading && (
        <div className="flex h-20 items-center justify-center text-caption text-text-muted">
          Loading invite link…
        </div>
      )}

      {org.isError && (
        <div className="rounded-radius-md bg-status-danger-bg p-3 text-body-sm text-status-danger">
          Couldn&apos;t load your organization. Refresh to try again.
        </div>
      )}

      {org.data && inviteLink && (
        <div className="flex flex-col gap-4">
          {/* Share link — the primary action. Click-to-copy of a full URL
              the teammate just clicks; lands them on /signup with the
              invite code pre-filled. */}
          <div className="flex flex-col gap-2 rounded-radius-md bg-surface-sunken p-4">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-radius-full bg-accent-blue-20 text-accent-blue">
                <Link2 className="h-4 w-4" />
              </span>
              <div className="flex min-w-0 flex-col">
                <p className="text-body-strong text-text-default">Share invite link</p>
                <p className="text-caption text-text-muted">Teammates click + sign up in one shot.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-radius-sm bg-surface-default px-3 py-2 font-mono text-caption text-text-default">
                {inviteLink}
              </code>
              <Button
                variant="primary"
                size="sm"
                leadingIcon={copied === "link" ? Check : Copy}
                onClick={() => copyToClipboard(inviteLink, "link")}
              >
                {copied === "link" ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>

          {/* Raw invite code — for the small % of cases where a teammate
              prefers to type it into the signup form (e.g. shared via
              voice over a call, or pasted into a non-clickable channel). */}
          <div className="flex items-center justify-between gap-3 rounded-radius-md border border-border-subtle p-3">
            <div className="flex min-w-0 flex-col">
              <p className="text-caption text-text-muted">Or share just the code</p>
              <code className="truncate font-mono text-body-strong text-text-default">
                {org.data.inviteCode}
              </code>
            </div>
            <Button
              variant="tertiary"
              size="sm"
              leadingIcon={copied === "code" ? Check : Copy}
              onClick={() => copyToClipboard(org.data!.inviteCode, "code")}
            >
              {copied === "code" ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Account ──────────────────────────────────────────────────────────

function AccountSection() {
  const navigate = useNavigate();
  const signOut = useAuth((s) => s.signOut);
  const [signingOut, setSigningOut] = React.useState(false);

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      navigate("/login", { replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't sign out");
      setSigningOut(false);
    }
  };

  return (
    <Card padding="md">
      <h2 className="mb-1 text-body-strong text-text-default">Account</h2>
      <p className="mb-4 text-caption text-text-muted">
        Sign out, or permanently delete your account.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="md" leadingIcon={LogOut} onClick={onSignOut} loading={signingOut}>
          Sign out
        </Button>
        <Button
          variant="tertiary"
          size="md"
          leadingIcon={Trash2}
          onClick={() => toast("Delete account lands in Sprint 2")}
          className="text-status-danger hover:bg-status-danger-bg"
        >
          Delete account
        </Button>
      </div>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────

export function SettingsPage() {
  const user = useAuth((s) => s.user);
  const showTeamSection = canInviteTeam(user);

  return (
    <div className="w-full px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-6 flex flex-col gap-1">
          <h1 className="text-heading-lg text-text-default">Settings</h1>
          <p className="text-body-md text-text-muted">Profile, industry, appearance, and account.</p>
        </header>

      <div className="flex flex-col gap-4 lg:gap-6">
        <ProfileSection />
        <ProfessionSection />
        <AppearanceSection />
        <NotificationsSection />
        {showTeamSection && <TeamSection />}
        <AccountSection />
      </div>
      </div>
    </div>
  );
}

export default SettingsPage;
