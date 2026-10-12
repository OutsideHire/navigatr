/**
 * The invite token, kept for this tab only (1A tracker item). PortalInvitePage
 * moves the token out of the address bar on first load; without this, reloading
 * the terms screen lost it and showed "expired". sessionStorage dies with the
 * tab, is keyed per tenant slug, and is cleared once the invite is accepted.
 */
export function inviteTokenKey(slug: string): string {
  return `navigatr-portal-invite:${slug}`;
}

export function readInviteToken(slug: string): string | null {
  try {
    return window.sessionStorage.getItem(inviteTokenKey(slug)) || null;
  } catch {
    return null;
  }
}

export function writeInviteToken(slug: string, token: string): void {
  try {
    window.sessionStorage.setItem(inviteTokenKey(slug), token);
  } catch {
    // Storage refused; a reload will need the link again.
  }
}

export function clearInviteToken(slug: string): void {
  try {
    window.sessionStorage.removeItem(inviteTokenKey(slug));
  } catch {
    // Nothing stored that we can reach.
  }
}
