/**
 * The Turnstile check, shown on the public referral form only after the
 * server asked for it. Calls onToken with the check's token (the page then
 * sends the referral again with it) and onError when the check or its script
 * fails. The latest callbacks are always used, without re-rendering the check.
 */
import * as React from "react";
import { loadTurnstile, type TurnstileApi } from "../lib/turnstile";

export function TurnstileWidget({
  siteKey,
  onToken,
  onError,
}: {
  siteKey: string;
  onToken: (token: string) => void;
  onError: () => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const handlers = React.useRef({ onToken, onError });
  React.useEffect(() => {
    handlers.current = { onToken, onError };
  });

  React.useEffect(() => {
    let cancelled = false;
    let api: TurnstileApi | null = null;
    let widgetId: string | null = null;
    if (!siteKey) {
      handlers.current.onError();
      return;
    }
    loadTurnstile()
      .then((loaded) => {
        if (cancelled || !ref.current) return;
        api = loaded;
        widgetId = loaded.render(ref.current, {
          sitekey: siteKey,
          theme: "auto",
          callback: (token) => handlers.current.onToken(token),
          "error-callback": () => handlers.current.onError(),
        });
      })
      .catch(() => {
        if (!cancelled) handlers.current.onError();
      });
    return () => {
      cancelled = true;
      if (api && widgetId !== null) api.remove(widgetId);
    };
  }, [siteKey]);

  return <div ref={ref} className="flex min-h-[65px] justify-center" />;
}
