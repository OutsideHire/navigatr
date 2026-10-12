/**
 * Cloudflare Turnstile for the public referral form (FR-PORT-30). The script
 * loads only after portal_api answers captcha_required, so people under the
 * limit never fetch anything from Cloudflare. Explicit render: the widget is
 * placed by TurnstileWidget, not by a class name scan.
 *
 * The site key is public (VITE_TURNSTILE_SITE_KEY). Unset means the page tells
 * the person to try later instead of showing a broken check.
 */
export const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export interface TurnstileRenderOptions {
  sitekey: string;
  callback: (token: string) => void;
  "error-callback"?: () => void;
  theme?: "auto" | "light" | "dark";
}

export interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

export function turnstileSiteKey(): string {
  return (import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "").trim();
}

/** Adds the script once; a failed load is forgotten so the next call tries again. */
export function loadTurnstile(doc: Document = document): Promise<TurnstileApi> {
  const ready = doc.defaultView?.turnstile;
  if (ready) return Promise.resolve(ready);
  if (loading) return loading;
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const script = doc.createElement("script");
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const api = doc.defaultView?.turnstile;
      if (api) {
        resolve(api);
        return;
      }
      loading = null;
      script.remove();
      reject(new Error("turnstile_missing"));
    };
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error("turnstile_load_failed"));
    };
    doc.head.appendChild(script);
  });
  return loading;
}

/** Tests only: forget a finished or pending load. */
export function resetTurnstileLoader(): void {
  loading = null;
}
