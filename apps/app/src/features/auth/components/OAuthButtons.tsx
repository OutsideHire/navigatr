import { Link } from "react-router-dom";
import { Button } from "@/components/navigatr";
import { useAuth } from "@/stores/auth";
import { toast } from "sonner";

/** Inline brand glyphs — flat SVG, sized to inherit currentColor where useful. */
function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.07 5.07 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.99.66-2.25 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.11A6.6 6.6 0 0 1 5.5 12c0-.74.13-1.45.34-2.11V7.05H2.18A11 11 0 0 0 1 12c0 1.77.42 3.45 1.18 4.95l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.2 1.65l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

/**
 * Both SSO buttons in a vertical stack. Identical across Login, Sign Up, and
 * Invitation pages so we keep them in one place.
 */
export function OAuthButtons({
  disabled,
  inviteCode,
  consentNote = false,
}: {
  disabled?: boolean;
  /**
   * Optional invite code passed into the OAuth redirectTo URL. Required for
   * first-time signups on /signup; omitted for /login where the user already
   * has a profile. The /auth/callback page reads it and calls claim_invite_code.
   */
  inviteCode?: string;
  /**
   * Show a passive "by continuing you agree" consent line under the button.
   * Google OAuth auto-provisions an account for a brand-new user, so on pages
   * WITHOUT an explicit consent checkbox (i.e. /login) this covers the
   * account-creation edge. Signup + create-workspace pages leave it off; their
   * required checkbox already captures consent for that path.
   */
  consentNote?: boolean;
}) {
  const signInWithGoogle = useAuth((s) => s.signInWithGoogle);

  const onGoogle = async () => {
    try {
      await signInWithGoogle(inviteCode || undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Google sign-in failed");
    }
  };

  // Microsoft/Azure SSO disabled until the provider is enabled in Supabase
  // (Auth → Providers → Azure). Re-add when configured. The store still
  // exposes signInWithMicrosoft; only the dead button is removed here.
  return (
    <div className="flex flex-col gap-3">
      <Button type="button" variant="secondary" size="lg" fullWidth onClick={onGoogle} disabled={disabled}>
        <GoogleIcon />
        Continue with Google
      </Button>
      {consentNote && (
        <p className="text-center text-caption text-text-muted">
          By continuing, you agree to our{" "}
          <Link
            to="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand-primary underline underline-offset-2"
          >
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link
            to="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand-primary underline underline-offset-2"
          >
            Privacy Policy
          </Link>
          .
        </p>
      )}
    </div>
  );
}

/** Visual divider between OAuth and email/password sections. */
export function OrDivider({ label = "or" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-px flex-1 bg-border-subtle" />
      <span className="text-caption uppercase tracking-wider text-text-subtle">{label}</span>
      <span className="h-px flex-1 bg-border-subtle" />
    </div>
  );
}
