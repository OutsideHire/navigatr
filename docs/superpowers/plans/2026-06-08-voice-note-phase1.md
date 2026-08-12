# Drop-in Voice Note — Phase 1 (audio-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Let a rep record an audio voice note on a drop-in, store it in a private Supabase bucket, attach it to the drop-in activity, and play it back on the deal — no transcription (Phase 2).

**Architecture:** A `useVoiceRecorder` (MediaRecorder) hook + `VoiceNoteRecorder` UI above the disposition tiles; an `uploadVoiceNote`/`signedUrlFor` storage helper; `activities.voice_note_url` plumbed through `useLogActivity` + `useActivities`; DropInSheet uploads on commit (engaged dispositions) or discards-with-confirm (terminal); a `VoiceNotePlayer` on `DealDetailPage`. One hand-applied migration (column + bucket + RLS).

**Tech Stack:** React + TS, browser MediaRecorder/getUserMedia (no dep), Supabase Storage (supabase-js v2), Vitest + Testing Library, navigatr design system.

---

## Conventions

- **Worktree/branch:** `feat/voice-note-phase1` off `main`. Do NOT work on `main`.
- Tests: `pnpm --filter app test <path-relative-to-apps/app>` from repo root, or `cd <worktree>/apps/app && pnpm test <path>`. cwd persists; `pnpm install` at worktree root if node_modules missing.
- Gate: `cd apps/app && pnpm typecheck && pnpm test`. "kaboom from Bomb" stderr = expected fixture.
- Commit trailer: blank line then `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Git from worktree root, one Bash call.
- **Migrations are hand-applied** (`supabase db query --linked -f <file>`, NOT db push) — Task 1 writes the file; APPLYING it is a manual operator step (flagged), not done by the implementer. Frontend code + tests don't depend on it being applied (tests mock supabase).
- Spec: `docs/superpowers/specs/2026-06-08-voice-note-phase1-design.md` (gitignored, on disk).

## Verified building blocks (from recon, current `main`)

- `supabase` from `@/lib/supabase` (supabase-js v2; `.storage` available). `useAuth((s) => s.user?.id)` from `@/stores/auth`. `useProfile` from `@/features/auth/useProfile`.
- `useLogActivity.ts`: `LogActivityInput { dealId, type, disposition, durationMinutes?, outcomeNotes?, occurredAt?, followUpDate?: string|null }`; insert writes `org_id`(profile)/`deal_id`/`logged_by`(userId)/`type`/`disposition`/`duration_minutes`/`outcome_notes`/`occurred_at`/`follow_up_date`(=`followUpDate?.slice(0,10) ?? null`) to `.from("activities").insert({...}).select("id").single()`.
- `useActivities.ts`: selects `"id, deal_id, type, disposition, duration_minutes, outcome_notes, occurred_at, follow_up_date"`; maps snake→camel into an `Activity` type (`outcomeNotes`, `durationMinutes`, `occurredAt`, `followUpDate`).
- `DealDetailPage.tsx`: `ActivityRow({ activity, onEdit })` renders a `ListRow` (title `Call · {min} · {spec.label}`, subtitle `activity.outcomeNotes || "No notes"`). `useActivities(dealId)` loads the list. `DISPOSITIONS` already imported.
- `DropInSheet.tsx` (post-redesign): state `selected/notes/customDate/saving/savingRef`; open-reset effect; `commit(disposition, customDateStr?)` (logVisit always; if `schedulesFollowUp(disposition) && !alreadyDealCreated` → createDeal + logActivity + markDealCreated, try/catch toast); `handleSelect` (followup_requested reveals date picker, else `void commit(key)`); `NotesFieldWithMic` below the tiles; footer Cancel only. Does NOT currently use `useAuth`.
- `activities` migration `20260519000002_activities.sql`: table cols listed above; RLS `select using (org_id = public.user_org_id())`, `insert with check (org_id = public.user_org_id() and logged_by = auth.uid())`. No storage bucket exists anywhere yet.
- Test patterns: `DropInSheet.test.tsx` mocks `@/features/pipeline/hooks/useCreateDeal`, `@/features/activities/hooks/useLogActivity`, `../hooks/useTodayPath`, `sonner`; has `logVisit`/`markDealCreated`/`stops` + a `merchant` fixture + `renderSheet`. `useLogActivity.test.tsx` mocks `@/lib/supabase` as `{ supabase: { from: () => ({ insert: insertMock }) } }`, plus `useAuth`/`useProfile`. `crypto.randomUUID` is available in the node test env (no mock needed).

## File structure

- **Create** `supabase/migrations/20260608000001_voice_notes.sql` (column + bucket + RLS).
- **Create** `apps/app/src/features/path/hooks/useVoiceRecorder.ts` (+test).
- **Create** `apps/app/src/features/path/components/VoiceNoteRecorder.tsx` (+test).
- **Create** `apps/app/src/features/path/lib/voiceNoteStorage.ts` (+test) — `extFor`, `uploadVoiceNote`, `signedUrlFor`.
- **Modify** `apps/app/src/features/activities/hooks/useLogActivity.ts` (+test) — `voiceNoteUrl`.
- **Modify** `apps/app/src/features/activities/hooks/useActivities.ts` — select + map `voice_note_url`→`voiceNoteUrl` on the `Activity` type.
- **Modify** `apps/app/src/features/path/components/DropInSheet.tsx` (+test) — recorder + upload-on-commit + terminal confirm.
- **Create** `apps/app/src/features/pipeline/components/VoiceNotePlayer.tsx` (+test) + **Modify** `DealDetailPage.tsx` `ActivityRow`.

---

## Task 1: Migration (hand-applied)

**Files:** Create `supabase/migrations/20260608000001_voice_notes.sql`.

- [ ] **Step 1: Write the migration**
```sql
-- 20260608000001_voice_notes.sql
-- Voice notes (Phase 1, audio-only): adds activities.voice_note_url + a PRIVATE
-- 'voice-notes' storage bucket with owner-folder RLS.
-- HAND-APPLIED (NOT db push):
--   supabase db query --linked -f supabase/migrations/20260608000001_voice_notes.sql
-- Owner-folder access means only the uploading rep can read/sign their own notes
-- (acceptable for Phase 1 "note to self"; org-wide playback is a Phase 2 concern).

alter table activities add column if not exists voice_note_url text;

insert into storage.buckets (id, name, public)
values ('voice-notes', 'voice-notes', false)
on conflict (id) do nothing;

create policy "voice_notes_insert_own" on storage.objects for insert
  with check (bucket_id = 'voice-notes' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "voice_notes_select_own" on storage.objects for select
  using (bucket_id = 'voice-notes' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "voice_notes_delete_own" on storage.objects for delete
  using (bucket_id = 'voice-notes' and (storage.foldername(name))[1] = auth.uid()::text);
```

- [ ] **Step 2: Commit** (do NOT attempt to apply it — that's a manual operator step)
```bash
git add supabase/migrations/20260608000001_voice_notes.sql
git commit -m "$(printf 'feat(db): voice_notes migration — activities.voice_note_url + private bucket + RLS\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```
> ⚠️ Flag in the final report: this migration must be hand-applied to the linked Supabase before the feature works end-to-end.

---

## Task 2: `useVoiceRecorder` hook

**Files:** Create `apps/app/src/features/path/hooks/useVoiceRecorder.ts` (+ `.test.ts`).

- [ ] **Step 1: Write the failing test** `useVoiceRecorder.test.ts`
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVoiceRecorder } from "./useVoiceRecorder";

// Fake MediaRecorder + getUserMedia.
class FakeRecorder {
  static isTypeSupported = vi.fn(() => true);
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  state = "inactive";
  constructor(public stream: unknown, public opts: { mimeType?: string }) {}
  start() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["x"], { type: "audio/webm" }) }); this.onstop?.(); }
}
const stopTrack = vi.fn();
const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] }));

beforeEach(() => {
  vi.stubGlobal("MediaRecorder", FakeRecorder as unknown as typeof MediaRecorder);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } } as unknown as Navigator);
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("useVoiceRecorder", () => {
  it("starts → recording, stops → recorded with a blob", async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    expect(result.current.state).toBe("idle");
    await act(async () => { await result.current.start(); });
    expect(result.current.state).toBe("recording");
    act(() => { result.current.stop(); });
    expect(result.current.state).toBe("recorded");
    expect(result.current.blob).toBeInstanceOf(Blob);
    expect(stopTrack).toHaveBeenCalled();
  });

  it("sets denied when getUserMedia rejects", async () => {
    getUserMedia.mockRejectedValueOnce(new Error("no"));
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => { await result.current.start(); });
    expect(result.current.state).toBe("denied");
  });

  it("auto-stops at the 2-minute cap", async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => { await result.current.start(); });
    act(() => { vi.advanceTimersByTime(120_000); });
    expect(result.current.state).toBe("recorded");
  });

  it("reset returns to idle", async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => { await result.current.start(); });
    act(() => { result.current.stop(); });
    act(() => { result.current.reset(); });
    expect(result.current.state).toBe("idle");
    expect(result.current.blob).toBeNull();
  });
});
```
Run → FAIL (module missing).

- [ ] **Step 2: Implement `useVoiceRecorder.ts`**
```ts
import * as React from "react";

export type RecorderState = "idle" | "recording" | "recorded" | "denied";
const CAP_MS = 120_000;
const PREFERRED_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

function pickMimeType(): string {
  const MR = (globalThis as unknown as { MediaRecorder?: { isTypeSupported?: (t: string) => boolean } }).MediaRecorder;
  if (MR?.isTypeSupported) {
    for (const t of PREFERRED_TYPES) if (MR.isTypeSupported(t)) return t;
  }
  return "audio/webm";
}

/** MediaRecorder state machine for a single drop-in voice memo. The parent owns
 *  the resulting blob (for upload). Auto-stops at 2 min; cleans up tracks. */
export function useVoiceRecorder() {
  const [state, setState] = React.useState<RecorderState>("idle");
  const [blob, setBlob] = React.useState<Blob | null>(null);
  const [durationMs, setDurationMs] = React.useState(0);
  const mimeRef = React.useRef<string>("audio/webm");
  const recRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const startedAtRef = React.useRef(0);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanupStream = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const stop = React.useCallback(() => {
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }, []);

  const start = React.useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      mimeRef.current = mimeType;
      const rec = new MediaRecorder(stream, { mimeType });
      recRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e: BlobEvent) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        setBlob(new Blob(chunksRef.current, { type: mimeRef.current }));
        setDurationMs(Date.now() - startedAtRef.current);
        setState("recorded");
        cleanupStream();
      };
      startedAtRef.current = Date.now();
      rec.start();
      setState("recording");
      timerRef.current = setTimeout(() => stop(), CAP_MS);
    } catch {
      setState("denied");
      cleanupStream();
    }
  }, [cleanupStream, stop]);

  const reset = React.useCallback(() => {
    cleanupStream();
    recRef.current = null;
    chunksRef.current = [];
    setBlob(null);
    setDurationMs(0);
    setState("idle");
  }, [cleanupStream]);

  React.useEffect(() => () => cleanupStream(), [cleanupStream]);

  return { state, blob, durationMs, mimeType: mimeRef.current, start, stop, reset };
}
```
> NOTE: `Date.now()` is fine in app/component code (the no-`Date.now` rule is only for Workflow scripts). Tests use fake timers; `Date.now()` advances with `vi.advanceTimersByTime`.

- [ ] **Step 3: Run → PASS.** Then `cd apps/app && pnpm typecheck`.
- [ ] **Step 4: Commit**
```bash
git add apps/app/src/features/path/hooks/useVoiceRecorder.ts apps/app/src/features/path/hooks/useVoiceRecorder.test.ts
git commit -m "$(printf 'feat(path): useVoiceRecorder hook (MediaRecorder, 2-min cap, denied state)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: `VoiceNoteRecorder` component (presentational)

**Files:** Create `apps/app/src/features/path/components/VoiceNoteRecorder.tsx` (+ `.test.tsx`).

- [ ] **Step 1: Write the failing test** `VoiceNoteRecorder.test.tsx`
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VoiceNoteRecorder } from "./VoiceNoteRecorder";

const base = { durationMs: 0, blob: null as Blob | null, onStart: vi.fn(), onStop: vi.fn(), onReset: vi.fn() };

describe("VoiceNoteRecorder", () => {
  it("idle: shows a record button that calls onStart", () => {
    const onStart = vi.fn();
    render(<VoiceNoteRecorder {...base} state="idle" onStart={onStart} />);
    fireEvent.click(screen.getByRole("button", { name: /record|voice note/i }));
    expect(onStart).toHaveBeenCalled();
  });
  it("recording: shows a stop button + timer that calls onStop", () => {
    const onStop = vi.fn();
    render(<VoiceNoteRecorder {...base} state="recording" durationMs={5000} onStop={onStop} />);
    expect(screen.getByText(/0:05/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /stop/i }));
    expect(onStop).toHaveBeenCalled();
  });
  it("recorded: renders an audio player + delete that calls onReset", () => {
    const onReset = vi.fn();
    render(<VoiceNoteRecorder {...base} state="recorded" blob={new Blob(["x"], { type: "audio/webm" })} durationMs={3000} onReset={onReset} />);
    expect(document.querySelector("audio")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /delete|re-record/i }));
    expect(onReset).toHaveBeenCalled();
  });
  it("denied: shows a mic-blocked message", () => {
    render(<VoiceNoteRecorder {...base} state="denied" />);
    expect(screen.getByText(/microphone|blocked|enable/i)).toBeInTheDocument();
  });
});
```
Run → FAIL.

- [ ] **Step 2: Implement `VoiceNoteRecorder.tsx`**
```tsx
import * as React from "react";
import { Mic, Square, Trash2, MicOff } from "lucide-react";
import type { RecorderState } from "../hooks/useVoiceRecorder";

interface VoiceNoteRecorderProps {
  state: RecorderState;
  durationMs: number;
  blob: Blob | null;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
}

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Voice-note recorder shown ABOVE the disposition tiles in the drop-in sheet.
 *  Presentational — the parent owns the useVoiceRecorder state + the blob. */
export function VoiceNoteRecorder({ state, durationMs, blob, onStart, onStop, onReset }: VoiceNoteRecorderProps) {
  const audioUrl = React.useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  React.useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  return (
    <div className="flex flex-col gap-2 rounded-radius-md border border-border-subtle bg-surface-sunken/40 p-3">
      <span className="text-caption font-medium text-text-muted">Voice note (optional)</span>
      {state === "idle" && (
        <button type="button" onClick={onStart} className="inline-flex items-center gap-2 self-start rounded-radius-md bg-brand-primary px-3 py-2 text-body-sm font-medium text-brand-primary-foreground">
          <Mic className="h-4 w-4" aria-hidden /> Record a voice note
        </button>
      )}
      {state === "recording" && (
        <div className="flex items-center gap-3">
          <span className="inline-flex h-2.5 w-2.5 animate-pulse rounded-radius-full bg-status-danger" aria-hidden />
          <span className="text-body-sm tabular-nums text-text-default">{fmt(durationMs)}</span>
          <button type="button" onClick={onStop} className="inline-flex items-center gap-2 rounded-radius-md border border-border-default px-3 py-1.5 text-body-sm">
            <Square className="h-3.5 w-3.5" aria-hidden /> Stop
          </button>
        </div>
      )}
      {state === "recorded" && audioUrl && (
        <div className="flex items-center gap-3">
          <audio controls src={audioUrl} className="h-9 flex-1" />
          <button type="button" aria-label="Delete voice note" onClick={onReset} className="rounded-radius-sm p-1.5 text-text-subtle hover:text-status-danger">
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
      {state === "denied" && (
        <p className="inline-flex items-center gap-2 text-caption text-status-danger">
          <MicOff className="h-4 w-4" aria-hidden /> Microphone is blocked — enable mic access to record.
        </p>
      )}
    </div>
  );
}
```
> VERIFY token names against a sibling (e.g. `bg-brand-primary`, `text-brand-primary-foreground`, `bg-surface-sunken`, `border-border-subtle`) — adjust to what exists. `jsdom` doesn't implement `URL.createObjectURL`; the test env may need it stubbed — if the test errors on it, add `vi.stubGlobal` for `URL.createObjectURL`/`revokeObjectURL` returning a fake string in the test file's setup.

- [ ] **Step 3: Run → PASS** (add the `URL.createObjectURL` stub to the test if needed). Typecheck.
- [ ] **Step 4: Commit**
```bash
git add apps/app/src/features/path/components/VoiceNoteRecorder.tsx apps/app/src/features/path/components/VoiceNoteRecorder.test.tsx
git commit -m "$(printf 'feat(path): VoiceNoteRecorder UI (record/stop/playback/delete states)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: Storage helper `voiceNoteStorage.ts`

**Files:** Create `apps/app/src/features/path/lib/voiceNoteStorage.ts` (+ `.test.ts`).

- [ ] **Step 1: Write the failing test** `voiceNoteStorage.test.ts`
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const uploadMock = vi.fn();
const createSignedUrlMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { storage: { from: vi.fn(() => ({ upload: uploadMock, createSignedUrl: createSignedUrlMock })) } },
}));
import { extFor, uploadVoiceNote, signedUrlFor } from "./voiceNoteStorage";

beforeEach(() => { uploadMock.mockReset(); createSignedUrlMock.mockReset(); });

describe("voiceNoteStorage", () => {
  it("extFor maps known mime types, defaults to webm", () => {
    expect(extFor("audio/webm;codecs=opus")).toBe("webm");
    expect(extFor("audio/mp4")).toBe("m4a");
    expect(extFor("audio/weird")).toBe("webm");
  });
  it("uploadVoiceNote uploads under {userId}/ and returns the path", async () => {
    uploadMock.mockResolvedValueOnce({ data: {}, error: null });
    const path = await uploadVoiceNote(new Blob(["x"], { type: "audio/webm" }), "audio/webm", "user-1");
    expect(path).toMatch(/^user-1\/.+\.webm$/);
    expect(uploadMock).toHaveBeenCalledWith(path, expect.any(Blob), { contentType: "audio/webm" });
  });
  it("uploadVoiceNote throws on storage error", async () => {
    uploadMock.mockResolvedValueOnce({ data: null, error: new Error("boom") });
    await expect(uploadVoiceNote(new Blob(["x"]), "audio/webm", "u")).rejects.toThrow();
  });
  it("signedUrlFor returns the signed url", async () => {
    createSignedUrlMock.mockResolvedValueOnce({ data: { signedUrl: "https://signed" }, error: null });
    await expect(signedUrlFor("user-1/abc.webm")).resolves.toBe("https://signed");
  });
});
```
Run → FAIL.

- [ ] **Step 2: Implement `voiceNoteStorage.ts`**
```ts
import { supabase } from "@/lib/supabase";

const BUCKET = "voice-notes";
const EXT: Record<string, string> = {
  "audio/webm": "webm",
  "audio/webm;codecs=opus": "webm",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
};

export function extFor(mimeType: string): string {
  return EXT[mimeType] ?? "webm";
}

/** Upload a voice-note blob under the user's own folder; returns the object path. */
export async function uploadVoiceNote(blob: Blob, mimeType: string, userId: string): Promise<string> {
  const path = `${userId}/${crypto.randomUUID()}.${extFor(mimeType)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: mimeType });
  if (error) throw error;
  return path;
}

/** Short-lived signed URL for playback (private bucket). */
export async function signedUrlFor(path: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data) throw error ?? new Error("Could not sign voice-note URL");
  return data.signedUrl;
}
```
- [ ] **Step 3: Run → PASS.** Typecheck.
- [ ] **Step 4: Commit**
```bash
git add apps/app/src/features/path/lib/voiceNoteStorage.ts apps/app/src/features/path/lib/voiceNoteStorage.test.ts
git commit -m "$(printf 'feat(path): voiceNoteStorage upload + signed-url helper\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: Plumb `voiceNoteUrl` through activities hooks

**Files:** Modify `apps/app/src/features/activities/hooks/useLogActivity.ts` (+ `.test.tsx`) and `useActivities.ts`.

- [ ] **Step 1: Extend `useLogActivity.test.tsx`** — add a case asserting `voice_note_url` is written:
```ts
it("writes voice_note_url when voiceNoteUrl is provided", async () => {
  // authUserId/profileOrgId set as in the existing passing tests; singleMock resolves { data:{id:"a1"}, error:null }
  singleMock.mockResolvedValueOnce({ data: { id: "a1" }, error: null });
  const { result } = renderHook(() => useLogActivity(), { wrapper: makeWrapper(new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) });
  await result.current.mutateAsync({ dealId: "d1", type: "drop_in", disposition: "statement_secured", voiceNoteUrl: "user-1/x.webm" });
  expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ voice_note_url: "user-1/x.webm" }));
});
it("writes voice_note_url null when omitted", async () => {
  singleMock.mockResolvedValueOnce({ data: { id: "a1" }, error: null });
  const { result } = renderHook(() => useLogActivity(), { wrapper: makeWrapper(new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) });
  await result.current.mutateAsync({ dealId: "d1", type: "drop_in", disposition: "not_interested" });
  expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ voice_note_url: null }));
});
```
(Match the existing test's auth/profile setup — set `authUserId`/`profileOrgId` in `beforeEach` like the passing tests do.) Run → FAIL.

- [ ] **Step 2: Edit `useLogActivity.ts`** — add to `LogActivityInput`:
```ts
  voiceNoteUrl?: string | null;
```
and add to the insert payload object:
```ts
  voice_note_url: input.voiceNoteUrl ?? null,
```
- [ ] **Step 3: Edit `useActivities.ts`** — add `voice_note_url` to the select string:
```ts
.select(
  "id, deal_id, type, disposition, duration_minutes, " +
    "outcome_notes, occurred_at, follow_up_date, voice_note_url",
)
```
add `voice_note_url: string | null;` to the `ActivityRow` interface, `voiceNoteUrl: string | null;` to the mapped `Activity` type, and map it in the row→Activity transform: `voiceNoteUrl: row.voice_note_url`.
- [ ] **Step 4: Run** the activities hook tests → PASS; `pnpm typecheck`.
- [ ] **Step 5: Commit**
```bash
git add apps/app/src/features/activities/hooks/useLogActivity.ts apps/app/src/features/activities/hooks/useLogActivity.test.tsx apps/app/src/features/activities/hooks/useActivities.ts
git commit -m "$(printf 'feat(activities): plumb voice_note_url through log + read hooks\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 6: DropInSheet — recorder + upload-on-commit + terminal confirm

**Files:** Modify `apps/app/src/features/path/components/DropInSheet.tsx` (+ `.test.tsx`).

- [ ] **Step 1: Extend `DropInSheet.test.tsx`.** Add to the existing mock block: mock the recorder + upload + auth so the sheet can drive them. Because the sheet will call `useVoiceRecorder()` and `uploadVoiceNote`, mock both:
```tsx
// controllable recorder
let recorderState = "idle";
const recorderBlob = new Blob(["x"], { type: "audio/webm" });
const recStart = vi.fn(); const recStop = vi.fn(); const recReset = vi.fn();
vi.mock("../hooks/useVoiceRecorder", () => ({
  useVoiceRecorder: () => ({ state: recorderState, blob: recorderState === "recorded" ? recorderBlob : null, durationMs: 3000, mimeType: "audio/webm", start: recStart, stop: recStop, reset: recReset }),
}));
const uploadVoiceNote = vi.fn().mockResolvedValue("user-1/x.webm");
vi.mock("../lib/voiceNoteStorage", () => ({ uploadVoiceNote: (...a: unknown[]) => uploadVoiceNote(...a), signedUrlFor: vi.fn() }));
vi.mock("@/stores/auth", () => ({ useAuth: (sel: (s: { user: { id: string } }) => unknown) => sel({ user: { id: "user-1" } }) }));
// VoiceNoteRecorder is presentational; let it render via the real component (it just shows state). Or mock it to a testid if simpler.
```
Reset `recorderState = "idle"` in `beforeEach`. Add tests:
```tsx
it("engaged disposition with a recording uploads + passes voiceNoteUrl to logActivity", async () => {
  recorderState = "recorded";
  renderSheet();
  await act(async () => { fireEvent.click(screen.getByText("Statement Secured")); });
  expect(uploadVoiceNote).toHaveBeenCalledWith(recorderBlob, "audio/webm", "user-1");
  expect(logActivityMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ voiceNoteUrl: "user-1/x.webm" }));
});
it("terminal disposition with a recording asks to confirm and discards (no upload) on confirm", async () => {
  recorderState = "recorded";
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  renderSheet();
  await act(async () => { fireEvent.click(screen.getByText("Not Interested")); });
  expect(confirmSpy).toHaveBeenCalled();
  expect(uploadVoiceNote).not.toHaveBeenCalled();
  expect(logVisit).toHaveBeenCalledWith("m-1", "not_interested");
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
it("terminal + recording + confirm cancelled aborts the commit", async () => {
  recorderState = "recorded";
  vi.spyOn(window, "confirm").mockReturnValue(false);
  renderSheet();
  await act(async () => { fireEvent.click(screen.getByText("Not Interested")); });
  expect(logVisit).not.toHaveBeenCalled();
  expect(onOpenChange).not.toHaveBeenCalled();
});
it("no recording: commit unchanged (no upload)", async () => {
  recorderState = "idle";
  renderSheet();
  await act(async () => { fireEvent.click(screen.getByText("Statement Secured")); });
  expect(uploadVoiceNote).not.toHaveBeenCalled();
  expect(logActivityMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ voiceNoteUrl: null }));
});
```
Run → FAIL.

- [ ] **Step 2: Edit `DropInSheet.tsx`.**
  - Imports: add `import { useAuth } from "@/stores/auth";`, `import { useVoiceRecorder } from "../hooks/useVoiceRecorder";`, `import { VoiceNoteRecorder } from "./VoiceNoteRecorder";`, `import { uploadVoiceNote } from "../lib/voiceNoteStorage";`.
  - In the component: `const userId = useAuth((s) => s.user?.id);` and `const recorder = useVoiceRecorder();`.
  - Open-reset effect: add `recorder.reset();` (so a re-opened sheet has no stale take). (Add `recorder` to the effect deps or call reset unconditionally inside the existing `if (open)` block — keep it inside the open branch.)
  - In `commit(disposition, customDateStr?)`, right after the `if (!merchant || savingRef.current) return;` guard, add the terminal-confirm gate:
```ts
    const hasRecording = recorder.state === "recorded" && recorder.blob != null;
    if (hasRecording && !schedulesFollowUp(disposition)) {
      // Terminal outcome → no deal/activity to attach the note to.
      if (!window.confirm("No deal is created for this outcome, so the voice note won't be saved. Log it anyway?")) {
        return;
      }
    }
```
  - Inside the engaged branch (`if (schedulesFollowUp(disposition) && !alreadyDealCreated) { try { ... } }`), upload BEFORE `logActivity` and pass the url:
```ts
        let voiceNoteUrl: string | null = null;
        if (hasRecording && userId) {
          try {
            voiceNoteUrl = await uploadVoiceNote(recorder.blob!, recorder.mimeType, userId);
          } catch {
            toast.error("Couldn't save the voice note — logging the visit anyway.");
          }
        }
        const { id: dealId } = await createDeal.mutateAsync({ /* unchanged */ });
        await logActivity.mutateAsync({
          dealId, type: "drop_in", disposition,
          outcomeNotes: notes.trim(), followUpDate, voiceNoteUrl,
        });
```
  (`hasRecording` is computed once above the guard so both the terminal gate and the engaged branch use it. Keep `savingRef`, the catch/toast, `markDealCreated`, `onLogged`, `onOpenChange` as-is.)
  - Render: add `<VoiceNoteRecorder ... />` as the FIRST child inside the scrollable container, ABOVE the tile grid:
```tsx
            <VoiceNoteRecorder
              state={recorder.state}
              durationMs={recorder.durationMs}
              blob={recorder.blob}
              onStart={() => void recorder.start()}
              onStop={recorder.stop}
              onReset={recorder.reset}
            />
```
  (Leave the tile grid, the followup_requested date block, `NotesFieldWithMic`, and the Cancel footer unchanged.)

- [ ] **Step 3: Run → PASS** (full `DropInSheet.test.tsx`). Typecheck. If the real `VoiceNoteRecorder` causes `URL.createObjectURL` errors in jsdom, either mock `VoiceNoteRecorder` to a stub in this test, or stub `URL.createObjectURL`.
- [ ] **Step 4: Commit**
```bash
git add apps/app/src/features/path/components/DropInSheet.tsx apps/app/src/features/path/components/DropInSheet.test.tsx
git commit -m "$(printf 'feat(path): record + attach a voice note on drop-in (upload on commit)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 7: Playback on the deal — `VoiceNotePlayer` in `ActivityRow`

**Files:** Create `apps/app/src/features/pipeline/components/VoiceNotePlayer.tsx` (+ `.test.tsx`); modify `DealDetailPage.tsx`.

- [ ] **Step 1: Write the failing test** `VoiceNotePlayer.test.tsx`
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const signedUrlFor = vi.fn();
vi.mock("@/features/path/lib/voiceNoteStorage", () => ({ signedUrlFor: (...a: unknown[]) => signedUrlFor(...a) }));
import { VoiceNotePlayer } from "./VoiceNotePlayer";

beforeEach(() => signedUrlFor.mockReset());

describe("VoiceNotePlayer", () => {
  it("fetches a signed url on play and renders an audio element", async () => {
    signedUrlFor.mockResolvedValueOnce("https://signed.example/a.webm");
    render(<VoiceNotePlayer path="user-1/a.webm" />);
    fireEvent.click(screen.getByRole("button", { name: /voice note|play/i }));
    await waitFor(() => expect(document.querySelector("audio")).toBeTruthy());
    expect(signedUrlFor).toHaveBeenCalledWith("user-1/a.webm");
  });
});
```
Run → FAIL.

- [ ] **Step 2: Implement `VoiceNotePlayer.tsx`**
```tsx
import * as React from "react";
import { Mic } from "lucide-react";
import { signedUrlFor } from "@/features/path/lib/voiceNoteStorage";

/** Lazily signs a private voice-note path and plays it. Owner-scoped: only the
 *  rep who recorded it can sign the URL (Phase 1). */
export function VoiceNotePlayer({ path }: { path: string }) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(false);

  const load = async () => {
    if (url || loading) return;
    setLoading(true); setError(false);
    try { setUrl(await signedUrlFor(path)); }
    catch { setError(true); }
    finally { setLoading(false); }
  };

  if (url) return <audio controls src={url} className="mt-1 h-8 w-full max-w-xs" />;
  return (
    <button type="button" onClick={() => void load()} disabled={loading}
      className="mt-1 inline-flex items-center gap-1.5 text-caption text-brand-primary hover:underline disabled:opacity-60">
      <Mic className="h-3.5 w-3.5" aria-hidden />
      {error ? "Couldn't load voice note — retry" : loading ? "Loading voice note…" : "Play voice note"}
    </button>
  );
}
```
- [ ] **Step 3: Run → PASS.** Typecheck.
- [ ] **Step 4: Wire into `DealDetailPage.tsx` `ActivityRow`.** Import `VoiceNotePlayer`. In `ActivityRow`, render the player under the row when the activity has a note. Since `ListRow` may not accept arbitrary children, wrap the row:
```tsx
function ActivityRow({ activity, onEdit }: { activity: Activity; onEdit?: (a: Activity) => void }) {
  const spec = DISPOSITIONS[activity.disposition];
  return (
    <div className="flex flex-col">
      <ListRow
        onClick={onEdit ? () => onEdit(activity) : undefined}
        leading={/* unchanged */}
        title={`Call · ${activity.durationMinutes ?? "—"} min · ${spec.label}`}
        subtitle={activity.outcomeNotes || "No notes"}
        trailing={/* unchanged */}
      />
      {activity.voiceNoteUrl && (
        <div className="pl-12 pr-3 pb-2">
          <VoiceNotePlayer path={activity.voiceNoteUrl} />
        </div>
      )}
    </div>
  );
}
```
(Match the existing `ActivityRow` markup; only wrap it + add the conditional player. Keep `leading`/`trailing` exactly as they are.)
- [ ] **Step 5: Run** the full suite `cd apps/app && pnpm test` + `pnpm typecheck`. If a `DealDetailPage` test exists and renders activities, it should be unaffected (no `voiceNoteUrl` on fixtures → no player). Fix any type fallout from the `Activity` type gaining `voiceNoteUrl` (it's nullable, so existing fixtures may need `voiceNoteUrl: null` if they construct `Activity` literally — add it where the compiler complains).
- [ ] **Step 6: Commit**
```bash
git add apps/app/src/features/pipeline/components/VoiceNotePlayer.tsx apps/app/src/features/pipeline/components/VoiceNotePlayer.test.tsx apps/app/src/features/pipeline/pages/DealDetailPage.tsx
git commit -m "$(printf 'feat(pipeline): play drop-in voice notes on the deal activity feed\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 8: Ship

- [ ] **Step 1: Full gate** — `cd apps/app && pnpm typecheck && pnpm test` (all green).
- [ ] **Step 2: APPLY THE MIGRATION (manual, required for the feature to work).** This is an operator step, not the implementer's: `supabase db query --linked -f supabase/migrations/20260608000001_voice_notes.sql`. Surface this prominently in the final report — without it, uploads/column writes fail at runtime.
- [ ] **Step 3: Manual smoke (after migration applied + deploy; HTTPS required for mic).** Drop-in → record a voice note above the tiles (mic permission prompt) → playback the take → tap an engaged disposition (e.g. Statement Secured) → deal created; open the deal → activity feed shows a "Play voice note" → plays. Tap a terminal disposition with a recording → confirm prompt → note discarded. Deny mic → denied state, can still log.
- [ ] **Step 4: Finish the branch** (superpowers:finishing-a-development-branch → merge + push).

---

## Self-Review

**Spec coverage:** migration (column + private bucket + owner RLS) → T1 ✅. `useVoiceRecorder` (MediaRecorder, 2-min cap, denied) → T2 ✅. `VoiceNoteRecorder` above tiles → T3 + wired in T6 ✅. `uploadVoiceNote`/`signedUrlFor` (path + signed URL) → T4 ✅. `activities.voice_note_url` plumbed (log + read) → T5 ✅. Record-then-tap; engaged→upload-on-commit + voiceNoteUrl; terminal→confirm+discard; upload failure non-fatal → T6 ✅. DealDetailPage `<audio>` via signed URL → T7 ✅. Out-of-scope (transcription, terminal/non-deal storage, consent notice) excluded ✅.

**Placeholder scan:** none — every step has full code/SQL. The few "VERIFY token names"/"if jsdom errors on createObjectURL, stub it" notes are concrete fallbacks, not deferrals.

**Type consistency:** `RecorderState` defined in T2, imported by T3 + used in T6. `useVoiceRecorder` returns `{ state, blob, durationMs, mimeType, start, stop, reset }` — consumed identically in T6 + the T3 props (`state/durationMs/blob/onStart/onStop/onReset`). `uploadVoiceNote(blob, mimeType, userId): Promise<string>` + `signedUrlFor(path): Promise<string>` defined T4, used T6 (upload) + T7 (sign). `LogActivityInput.voiceNoteUrl?: string|null` (T5) matches what T6 passes. `Activity.voiceNoteUrl: string|null` (T5) matches what T7's `ActivityRow` reads. Bucket name `voice-notes` consistent across T1/T4. Migration filename `20260608000001_voice_notes.sql` consistent T1/T8.
