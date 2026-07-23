/**
 * Per-auth-email content (subject/heading/body/cta/footnote) and the Supabase
 * verify-URL builder. Pure + dependency-free so vitest verifies it and the Deno
 * hook function imports it. The action types come from Supabase's Send-Email
 * hook `email_action_type` field.
 */
export interface AuthEmailContent {
  subject: string;
  heading: string;
  bodyLines: string[];
  ctaLabel: string;
  footnote: string;
}

export function authEmailContent(actionType: string): AuthEmailContent {
  switch (actionType) {
    case "signup":
      return {
        subject: "Confirm your navigatr email",
        heading: "Confirm your email",
        bodyLines: ["Tap the button below to verify your email and finish setting up your navigatr account."],
        ctaLabel: "Confirm email",
        footnote: "If you didn't create a navigatr account, you can ignore this email.",
      };
    case "recovery":
      return {
        subject: "Reset your navigatr password",
        heading: "Reset your password",
        bodyLines: ["We received a request to reset your navigatr password. Tap below to choose a new one."],
        ctaLabel: "Reset password",
        footnote: "If you didn't request this, ignore this email; your password stays the same.",
      };
    case "magiclink":
      return {
        subject: "Your navigatr sign-in link",
        heading: "Sign in to navigatr",
        bodyLines: ["Enter this 6-digit code on the sign-in screen, or tap the button below. It expires shortly."],
        ctaLabel: "Sign in to navigatr",
        footnote: "If this wasn't you, you can safely ignore this email.",
      };
    default:
      return {
        subject: "Action required for your navigatr account",
        heading: "Continue to navigatr",
        bodyLines: ["Tap the button below to continue."],
        ctaLabel: "Continue",
        footnote: "If this wasn't you, you can ignore this email.",
      };
  }
}

export function buildVerifyUrl(p: {
  siteUrl: string;
  tokenHash: string;
  type: string;
  redirectTo: string;
}): string {
  const base = `${p.siteUrl}/auth/v1/verify?token=${encodeURIComponent(p.tokenHash)}&type=${encodeURIComponent(p.type)}`;
  return p.redirectTo ? `${base}&redirect_to=${encodeURIComponent(p.redirectTo)}` : base;
}
