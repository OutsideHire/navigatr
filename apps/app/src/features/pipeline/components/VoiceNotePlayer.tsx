import * as React from "react";
import { Mic } from "lucide-react";
import { signedUrlFor } from "@/features/path/lib/voiceNoteStorage";

/** Lazily signs a private voice-note path and plays it. Owner-scoped (Phase 1):
 *  only the rep who recorded it can sign the URL. */
export function VoiceNotePlayer({ path }: { path: string }) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(false);

  const load = async () => {
    if (url || loading) return;
    setLoading(true);
    setError(false);
    try {
      setUrl(await signedUrlFor(path));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  if (url) return <audio controls src={url} className="mt-1 h-8 w-full max-w-xs" />;
  return (
    <button
      type="button"
      onClick={() => void load()}
      disabled={loading}
      className="mt-1 inline-flex items-center gap-1.5 text-caption text-brand-primary hover:underline disabled:opacity-60"
    >
      <Mic className="h-3.5 w-3.5" aria-hidden />
      {error ? "Couldn't load voice note — retry" : loading ? "Loading voice note…" : "Play voice note"}
    </button>
  );
}
