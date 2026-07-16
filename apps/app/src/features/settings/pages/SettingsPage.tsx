/**
 * SettingsPage — the "Personal" tab content of the Settings hub.
 *
 * Refactored per the design critique (SETTINGS_DESIGN_CRITIQUE.md):
 *  - Auto-save everywhere with toast; no Save buttons (debounced 500ms
 *    on text inputs, instant on radios/checkboxes).
 *  - Industry tiles neutralized (one indigo treatment per page, on the
 *    active card only).
 *  - "Backend wires in Sprint 2" copy leak removed.
 *  - Team card consolidated: single card with Link/Code switcher.
 *  - Account split into Session + Danger zone (red wash on Danger).
 *  - Section H2s carry subtitles for clarity.
 *
 * Header ("Personal settings" + subtitle) rendered by PersonalTab, not
 * here. SettingsPage is the body — sections only.
 */

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  CalendarClock,
  Check,
  Copy,
  CreditCard,
  Landmark,
  LogOut,
  Moon,
  Monitor,
  RefreshCw,
  Sun,
  Trash2,
  X,
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
import { useProfile } from "@/features/auth/useProfile";
import { useRotateInviteCode } from "@/features/admin/hooks/useRotateInviteCode";
import { useUpdateOrgValueBands } from "@/features/settings/hooks/useUpdateOrgValueBands";
import { buildValueBands } from "@/features/dashboard/lib/activityToWin";
import { DeleteAccountDialog } from "@/features/account/DeleteAccountDialog";

// Debounce delay for text-input auto-save. 500ms is the standard "fast
// enough to feel reactive, slow enough not to thrash" window — Linear,
// Notion, and Vercel all use 400-600ms.
const AUTOSAVE_DELAY_MS = 500;

// ── Profile ──────────────────────────────────────────────────────────

function ProfileSection() {
  const user = useAuth((s) => s.user);
  const initialName = getFullName(user);
  const [name, setName] = React.useState(initialName);
  // Three save states for the inline indicator:
  //   idle   — input matches server; nothing to show
  //   saving — debounce expired, request in flight
  //   saved  — request succeeded; show "Saved" briefly then idle
  type SaveState = "idle" | "saving" | "saved";
  const [saveState, setSaveState] = React.useState<SaveState>("idle");

  // Keep input in sync if `user` updates from another source (e.g.
  // OAuth profile refresh) and the local edit hasn't diverged.
  React.useEffect(() => {
    setName(initialName);
  }, [initialName]);

  // Debounced auto-save. The effect re-runs on every keystroke; the
  // cleanup cancels the timer if another keystroke arrives within the
  // window. Net effect: save fires 500ms after typing stops.
  React.useEffect(() => {
    const trimmed = name.trim();
    if (trimmed === initialName || trimmed.length === 0) {
      setSaveState("idle");
      return;
    }
    const timer = setTimeout(async () => {
      setSaveState("saving");
      try {
        const { error } = await supabase.auth.updateUser({
          data: { full_name: trimmed },
        });
        if (error) throw error;
        setSaveState("saved");
        toast.success("Saved");
        // Drop back to idle after a moment so the indicator doesn't stick.
        setTimeout(() => setSaveState("idle"), 1500);
      } catch (e) {
        setSaveState("idle");
        toast.error(e instanceof Error ? e.message : "Couldn't save name");
      }
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [name, initialName]);

  return (
    <Card padding="md">
      <SectionHeader
        title="Profile"
        subtitle="How you appear across navigatr."
        // Inline save indicator. Quiet when idle; "Saving…" while
        // pending; brief "Saved" confirmation after success.
        trailing={<AutoSavePill state={saveState} />}
      />
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <FormField htmlFor="profile-name" label="Full name">
          <Input
            id="profile-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jamie Rivera"
          />
        </FormField>
        <FormField
          htmlFor="profile-email"
          label="Work email"
          helper="Tied to your account. Contact support to change."
        >
          <Input id="profile-email" type="email" value={user?.email ?? ""} disabled />
        </FormField>
      </div>
    </Card>
  );
}

// ── Industry / Profession ────────────────────────────────────────────

interface ProfessionOption {
  value: Profession;
  label: string;
  description: string;
  Icon: typeof CreditCard;
}

// Critique #2 fix: drop per-profession brand colors. Unselected cards
// share a neutral icon tile; only the active card gets the brand
// treatment. One indigo per page.
const PROFESSION_OPTIONS: ProfessionOption[] = [
  {
    value: "payroll",
    label: "Payroll",
    description: "HR, benefits, time & attendance.",
    Icon: CalendarClock,
  },
  {
    value: "merchant_services",
    label: "Merchant Services",
    description: "Payment processing, terminals, ISVs.",
    Icon: CreditCard,
  },
  {
    value: "treasury_management",
    label: "Treasury Management",
    description: "Banking, treasury, cash management.",
    Icon: Landmark,
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
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't switch profession");
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card padding="md">
      <SectionHeader
        title="Industry"
        subtitle="Drives qualification fields, KPI defaults, and ICP filters."
      />
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
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
                "group relative flex flex-col gap-3 rounded-radius-md border bg-surface-elevated p-4 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-default",
                "disabled:cursor-not-allowed disabled:opacity-60",
                isActive
                  ? "border-brand-primary bg-brand-primary-10"
                  : "border-border-subtle hover:border-border-default",
              )}
            >
              <div className="flex items-start justify-between">
                <span
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-radius-md transition-colors",
                    // Neutral unselected, brand-primary on the active one.
                    // One indigo per page (critique #2).
                    isActive
                      ? "bg-brand-primary text-brand-primary-foreground"
                      : "bg-surface-sunken text-text-muted",
                  )}
                >
                  <opt.Icon className="h-4 w-4" />
                </span>
                {isActive && (
                  <span
                    aria-hidden
                    className="flex h-5 w-5 items-center justify-center rounded-radius-full bg-brand-primary text-brand-primary-foreground"
                  >
                    <Check className="h-3 w-3" />
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

  const onPick = (next: Theme) => {
    if (next === theme) return;
    setTheme(next);
    // Theme store is local + persisted; toast confirms the auto-save.
    toast.success("Saved");
  };

  return (
    <Card padding="md">
      <SectionHeader
        title="Appearance"
        subtitle="Theme follows your OS preference unless overridden."
      />
      <div
        role="radiogroup"
        aria-label="Theme"
        className="mt-4 flex flex-wrap gap-2"
      >
        {THEME_OPTIONS.map((opt) => {
          const isActive = theme === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => onPick(opt.value)}
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

// ── Notifications ────────────────────────────────────────────────────

// Notification toggles persist to localStorage. The actual notification
// backend (email digest, push, etc.) wiring is a separate work block;
// when it lands, this section reads/writes through a NotificationsService
// instead of localStorage. The UI contract stays the same either way.
//
// Critique #4 fix: removed the "Backend wires in Sprint 2" subtitle leak.
const NOTIFICATIONS_STORAGE_KEY = "navigatr:notifications";

interface NotificationPrefs {
  emailDigest: boolean;
  emailUrgent: boolean;
  pushDropIn: boolean;
  pushFollowup: boolean;
}
const DEFAULT_NOTIFICATIONS: NotificationPrefs = {
  emailDigest: true,
  emailUrgent: true,
  pushDropIn: true,
  pushFollowup: false,
};

function loadNotifications(): NotificationPrefs {
  if (typeof window === "undefined") return DEFAULT_NOTIFICATIONS;
  try {
    const raw = window.localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
    if (!raw) return DEFAULT_NOTIFICATIONS;
    return { ...DEFAULT_NOTIFICATIONS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_NOTIFICATIONS;
  }
}

function NotificationsSection() {
  const [prefs, setPrefs] = React.useState<NotificationPrefs>(() => loadNotifications());

  const update = (key: keyof NotificationPrefs, value: boolean) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    try {
      window.localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(next));
      toast.success("Saved");
    } catch {
      toast.error("Couldn't save notification preference");
    }
  };

  return (
    <Card padding="md">
      <SectionHeader
        title="Notifications"
        subtitle="Choose what you want to hear about."
      />
      <div className="mt-4 flex flex-col gap-3">
        <Checkbox
          id="notif-email-digest"
          label="Daily email digest"
          helper="Morning summary: today's tasks, overdue follow-ups, new partners."
          checked={prefs.emailDigest}
          onCheckedChange={(v) => update("emailDigest", v)}
        />
        <Checkbox
          id="notif-email-urgent"
          label="Urgent email alerts"
          helper="High-value deal stalled, smart follow-up missed."
          checked={prefs.emailUrgent}
          onCheckedChange={(v) => update("emailUrgent", v)}
        />
        <Checkbox
          id="notif-push-dropin"
          label="Push: nearby drop-in opportunity"
          helper="When Path discovers a high-ICP merchant within 0.5 mi."
          checked={prefs.pushDropIn}
          onCheckedChange={(v) => update("pushDropIn", v)}
        />
        <Checkbox
          id="notif-push-followup"
          label="Push: follow-up reminder"
          helper="15 minutes before a scheduled next-touch."
          checked={prefs.pushFollowup}
          onCheckedChange={(v) => update("pushFollowup", v)}
        />
      </div>
    </Card>
  );
}

// ── Team ─────────────────────────────────────────────────────────────

// Critique #5 + #6 fix: consolidate Link + Code into ONE card with a
// segmented control switcher. No more "Or share just the code" second
// card. No raw slug exposed as a top-level UI element.
type InviteShareMode = "link" | "code";

function TeamSection() {
  const org = useOrganization();
  const profile = useProfile();
  const [mode, setMode] = React.useState<InviteShareMode>("link");
  const [copied, setCopied] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  // Rotation locks out everyone holding the old link — admins only,
  // matching the Organization tab.
  const canRotate = profile.data?.role === "admin";
  const rotate = useRotateInviteCode();

  const inviteLink = org.data
    ? `${window.location.origin}/signup?code=${encodeURIComponent(org.data.inviteCode)}`
    : null;
  const inviteCode = org.data?.inviteCode ?? "";

  const copyValue = mode === "link" ? inviteLink ?? "" : inviteCode;

  const copyToClipboard = async () => {
    if (!copyValue) return;
    try {
      await navigator.clipboard.writeText(copyValue);
      setCopied(true);
      toast.success(mode === "link" ? "Invite link copied" : "Invite code copied");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't copy to clipboard");
    }
  };

  const handleRotate = async () => {
    try {
      await rotate.mutateAsync();
      toast.success("Invite link regenerated");
      setConfirmOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't regenerate the link. Try again.");
    }
  };

  return (
    <Card padding="md">
      <SectionHeader
        title="Invite teammates"
        subtitle={
          <>
            They&apos;ll join{" "}
            <span className="text-text-default">{org.data?.name ?? "your team"}</span>{" "}
            with one click.
          </>
        }
        trailing={<ShareModeSwitcher mode={mode} onChange={setMode} />}
      />

      {org.isLoading && (
        <div className="mt-4 flex h-12 items-center justify-center text-caption text-text-muted">
          Loading…
        </div>
      )}

      {org.isError && (
        <div className="mt-4 rounded-radius-md bg-status-danger-bg p-3 text-body-sm text-status-danger">
          Couldn&apos;t load your organization. Refresh to try again.
        </div>
      )}

      {org.data && (
        <>
          <div className="mt-4 flex items-center gap-2">
            <code
              aria-label={mode === "link" ? "Invite link" : "Invite code"}
              className="flex-1 truncate rounded-radius-sm border border-border-subtle bg-surface-sunken px-3 py-2 font-mono text-caption text-text-default"
            >
              {copyValue}
            </code>
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={copied ? Check : Copy}
              onClick={copyToClipboard}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          {/* Helper row. Rotation is real (admin-only) and mirrors the
              Organization tab; the email-invites link is an informational
              pointer to the per-agent flow on the Agents page. */}
          <div className="mt-3 flex items-center justify-between gap-3 text-caption text-text-muted">
            <span>
              Anyone with this {mode} can join.{" "}
              {canRotate && (
                <button
                  type="button"
                  onClick={() => setConfirmOpen(true)}
                  className="inline-flex items-center gap-1 text-brand-primary hover:underline"
                >
                  <RefreshCw className="h-3 w-3" />
                  Regenerate
                </button>
              )}
            </span>
            <button
              type="button"
              onClick={() => toast("Per-agent email invites: see the Agents page")}
              className="text-brand-primary hover:underline"
            >
              Email invites instead →
            </button>
          </div>
        </>
      )}

      {canRotate && (
        <Dialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
            <Dialog.Content
              aria-describedby="settings-rotate-desc"
              className={cn(
                "fixed z-50 flex flex-col bg-surface-default shadow-card-hover",
                "inset-x-0 bottom-0 max-h-[90dvh] rounded-t-radius-lg",
                "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-radius-lg",
              )}
            >
              <div className="flex items-center justify-between px-5 py-4">
                <Dialog.Title className="text-heading-sm">Regenerate invite link?</Dialog.Title>
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

              <div className="flex flex-col gap-4 px-5 pb-5">
                <p id="settings-rotate-desc" className="text-body-md text-text-default">
                  This breaks the current link. Anyone you&rsquo;ve already shared it with will
                  need the new one. Per-agent email invites are not affected.
                </p>

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
                    loading={rotate.isPending}
                    disabled={rotate.isPending}
                    onClick={handleRotate}
                  >
                    Regenerate link
                  </Button>
                </div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </Card>
  );
}

function ShareModeSwitcher({
  mode,
  onChange,
}: {
  mode: InviteShareMode;
  onChange: (m: InviteShareMode) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Share invite as"
      className="inline-flex items-center gap-0.5 rounded-radius-sm border border-border-subtle bg-surface-sunken p-0.5"
    >
      {(["link", "code"] as const).map((m) => {
        const active = mode === m;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(m)}
            className={cn(
              "rounded-radius-sm px-2.5 py-1 text-caption font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
              active
                ? "bg-surface-default text-text-default shadow-sm"
                : "text-text-muted hover:text-text-default",
            )}
          >
            {m === "link" ? "Link" : "Code"}
          </button>
        );
      })}
    </div>
  );
}

// ── Session + Danger zone ────────────────────────────────────────────
// Critique #11 (paraphrased): destructive actions deserve a wall.
// Splitting Account into two cards puts "Sign out" on a normal card and
// "Delete account" inside a red-washed Danger zone.

function SessionSection() {
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
      <SectionHeader
        title="Session"
        subtitle="Sign out of this device."
        trailing={
          <Button variant="secondary" size="md" leadingIcon={LogOut} onClick={onSignOut} loading={signingOut}>
            Sign out
          </Button>
        }
      />
    </Card>
  );
}

function DangerZoneSection() {
  // Two-stage delete flow: button opens the confirmation dialog;
  // dialog requires typing "DELETE" then calls the RPC + signs out.
  // No more "lands in v1.1" stub.
  const [dialogOpen, setDialogOpen] = React.useState(false);
  return (
    <>
      <Card
        padding="md"
        className="border-status-danger/30 bg-status-danger-bg/30"
      >
        <SectionHeader
          title={<span className="text-status-danger">Danger zone</span>}
          subtitle={
            <>
              Deleting your account anonymizes your name + email and signs
              you out. Your deals + activities stay with the team for
              business-record purposes.
            </>
          }
          trailing={
            <Button
              variant="tertiary"
              size="md"
              leadingIcon={Trash2}
              onClick={() => setDialogOpen(true)}
              className="border-status-danger/40 text-status-danger hover:bg-status-danger-bg"
            >
              Delete account
            </Button>
          }
        />
      </Card>
      <DeleteAccountDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}

// ── Shared section primitives ────────────────────────────────────────

interface SectionHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Optional element rendered on the right side of the header row
   *  (e.g. an action button or a "Saved" pill). */
  trailing?: React.ReactNode;
}

function SectionHeader({ title, subtitle, trailing }: SectionHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-body-strong text-text-default">{title}</h2>
        {subtitle && (
          <p className="mt-1 text-caption text-text-muted">{subtitle}</p>
        )}
      </div>
      {trailing}
    </div>
  );
}

/**
 * AutoSavePill — inline status indicator for auto-saved fields.
 * Idle: no pill (avoids visual noise during normal use).
 * Saving: "Saving…" in a muted pill.
 * Saved: "Saved" in a subtle success pill that fades back to idle after
 *        1.5 seconds.
 */
function AutoSavePill({ state }: { state: "idle" | "saving" | "saved" }) {
  if (state === "idle") return null;
  const isSaved = state === "saved";
  return (
    <span
      aria-live="polite"
      className={cn(
        "inline-flex items-center rounded-radius-full px-2 py-0.5 text-caption font-medium",
        isSaved
          ? "bg-status-success-bg text-status-success"
          : "bg-surface-sunken text-text-muted",
      )}
    >
      {isSaved ? "Saved" : "Saving…"}
    </span>
  );
}

// ── Page ─────────────────────────────────────────────────────────────

// ── Deal value bands (Activity-to-Win) ───────────────────────────────────
// Admin/manager-only. Two thresholds group won/lost deals into three size
// bands on the Activity-to-Win report. Empty = the app defaults.
export function ValueBandsSection() {
  const org = useOrganization();
  const update = useUpdateOrgValueBands();
  const [low, setLow] = React.useState("");
  const [high, setHigh] = React.useState("");

  // Seed the inputs (dollars) from the org's stored cents whenever they load
  // or change server-side.
  React.useEffect(() => {
    setLow(org.data?.valueBandLowCents != null ? String(org.data.valueBandLowCents / 100) : "");
    setHigh(org.data?.valueBandHighCents != null ? String(org.data.valueBandHighCents / 100) : "");
  }, [org.data?.valueBandLowCents, org.data?.valueBandHighCents]);

  const lowNum = Number(low);
  const highNum = Number(high);
  const bothFilled = low.trim() !== "" && high.trim() !== "";
  const valid =
    bothFilled && !Number.isNaN(lowNum) && !Number.isNaN(highNum) && lowNum >= 0 && highNum > lowNum;

  // Live preview of the resulting bands (defaults until the inputs are valid).
  const preview = valid
    ? buildValueBands(Math.round(lowNum * 100), Math.round(highNum * 100))
    : buildValueBands(null, null);

  const handleSave = async () => {
    if (!valid) {
      toast.error("Enter two amounts with the upper greater than the lower.");
      return;
    }
    try {
      await update.mutateAsync({
        lowCents: Math.round(lowNum * 100),
        highCents: Math.round(highNum * 100),
      });
      toast.success("Value bands saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save value bands. Try again.");
    }
  };

  const handleReset = async () => {
    try {
      await update.mutateAsync({ lowCents: null, highCents: null });
      toast.success("Reset to default bands");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't reset. Try again.");
    }
  };

  return (
    <Card padding="md">
      <SectionHeader
        title="Deal value bands"
        subtitle="Group Activity-to-Win deals by size. Leave blank to use the defaults (< $25K / $25K-$100K / > $100K)."
      />
      <div className="mt-4 flex flex-col gap-4">
        <div className="flex flex-wrap gap-4">
          <FormField htmlFor="band-low" label="Lower threshold ($)">
            <Input
              id="band-low"
              type="number"
              min={0}
              inputMode="numeric"
              placeholder="25000"
              value={low}
              onChange={(e) => setLow(e.target.value)}
            />
          </FormField>
          <FormField htmlFor="band-high" label="Upper threshold ($)">
            <Input
              id="band-high"
              type="number"
              min={0}
              inputMode="numeric"
              placeholder="100000"
              value={high}
              onChange={(e) => setHigh(e.target.value)}
            />
          </FormField>
        </div>
        <p className="text-caption text-text-muted">
          Bands: <span className="text-text-default">{preview.map((b) => b.label).join(" · ")}</span>
        </p>
        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={!valid || update.isPending}>
            Save bands
          </Button>
          <Button variant="tertiary" onClick={handleReset} disabled={update.isPending}>
            Reset to defaults
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function SettingsPage() {
  const user = useAuth((s) => s.user);
  const showTeamSection = canInviteTeam(user);
  const role = useProfile().data?.role;
  const canEditBands = role === "manager" || role === "admin";

  // No page-level chrome here — the H1 + subtitle live in PersonalTab.
  // SettingsPage just renders sections in order.
  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <ProfileSection />
      <ProfessionSection />
      <AppearanceSection />
      <NotificationsSection />
      {showTeamSection && <TeamSection />}
      {canEditBands && <ValueBandsSection />}
      <SessionSection />
      <DangerZoneSection />
    </div>
  );
}

export default SettingsPage;
