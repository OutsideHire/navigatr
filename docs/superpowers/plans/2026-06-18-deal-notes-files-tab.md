# Deal Detail "Notes & Files" tab — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Fill the Notes & Files placeholder with a server-backed timestamped notes feed + file attachments (new `deal_notes` + `deal_files` tables, a private `deal-files` bucket, hooks, a storage lib, and a `NotesAndFilesTab`).

**Spec:** `/Users/ryanmeo/navigatr/docs/superpowers/specs/2026-06-18-deal-notes-files-tab-design.md`

Run pnpm from `/Users/ryanmeo/navigatr/.claude/worktrees/notes-files/apps/app` (worktree-local `pnpm typecheck` / `pnpm test <pattern>`).

**Reference files to mirror (read them):** `features/pipeline/hooks/useDealContacts.ts` (+`.test.tsx`) for the supabase CRUD-hook + mock idiom and the org-derived-trigger insert (no org_id sent); `features/path/lib/voiceNoteStorage.ts` for the storage lib; `supabase/migrations/20260618000001_deal_contacts.sql` + `20260608000001_voice_notes.sql` for the migration/trigger/RLS/bucket idioms; `features/pipeline/components/ContactsTab.tsx` for the tab UI pattern; `pages/DealDetailPage.tsx` for the placeholder wiring.

---

### Task 1: migration (both tables + bucket) + `deal_notes` hooks (TDD)

**Files:** create `supabase/migrations/20260618000002_deal_notes_files.sql`; create `features/pipeline/hooks/useDealNotes.ts` (+ `.test.tsx`).

- [ ] **Step 1: migration** — create `supabase/migrations/20260618000002_deal_notes_files.sql` EXACTLY as the spec's section A (deal_notes + deal_files tables, both org-deriving triggers, RLS, the private `deal-files` bucket + 3 storage.objects policies). Header: `-- HAND-APPLIED (NOT db push): supabase db query --linked -f supabase/migrations/20260618000002_deal_notes_files.sql`. (SQL isn't run by vitest.)

- [ ] **Step 2: `useDealNotes.test.tsx`** — mirror `useDealContacts.test.tsx`'s supabase mock. Cover: `useDealNotes(dealId)` selects `deal_notes` by `deal_id` ordered `created_at desc`, maps row→`DealNote`; `useCreateDealNote` inserts `{ deal_id, created_by, body }` (NOT org_id) and invalidates `["deal-notes", dealId]`; `useDeleteDealNote` deletes by id and invalidates.

- [ ] **Step 3: run** `pnpm test useDealNotes` → FAIL. **Step 4: implement `useDealNotes.ts`:**
```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";

export interface DealNote { id: string; dealId: string; body: string; createdBy: string; createdAt: string; }
interface DealNoteRow { id: string; deal_id: string; body: string; created_by: string; created_at: string; }
const toNote = (r: DealNoteRow): DealNote => ({ id: r.id, dealId: r.deal_id, body: r.body, createdBy: r.created_by, createdAt: r.created_at });
export const DEAL_NOTES_KEY = (dealId: string) => ["deal-notes", dealId] as const;

export function useDealNotes(dealId: string) {
  return useQuery({
    queryKey: DEAL_NOTES_KEY(dealId),
    queryFn: async (): Promise<DealNote[]> => {
      const { data, error } = await supabase.from("deal_notes").select("*").eq("deal_id", dealId).order("created_at", { ascending: false });
      if (error) throw error;
      return (data as DealNoteRow[]).map(toNote);
    },
    enabled: !!dealId,
  });
}
export function useCreateDealNote() {
  const qc = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  return useMutation({
    mutationFn: async ({ dealId, body }: { dealId: string; body: string }) => {
      if (!userId) throw new Error("Not signed in");
      const { data, error } = await supabase.from("deal_notes").insert({ deal_id: dealId, created_by: userId, body }).select("id").single();
      if (error) throw error;
      return { id: data.id as string };
    },
    onSuccess: (_r, v) => { void qc.invalidateQueries({ queryKey: DEAL_NOTES_KEY(v.dealId) }); },
  });
}
export function useDeleteDealNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; dealId: string }) => {
      const { error } = await supabase.from("deal_notes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_r, v) => { void qc.invalidateQueries({ queryKey: DEAL_NOTES_KEY(v.dealId) }); },
  });
}
```

- [ ] **Step 5: run** `pnpm test useDealNotes` → PASS. `pnpm typecheck` → clean. **Commit:**
```bash
git add supabase/migrations/20260618000002_deal_notes_files.sql apps/app/src/features/pipeline/hooks/useDealNotes.ts apps/app/src/features/pipeline/hooks/useDealNotes.test.tsx
git commit -m "feat(pipeline): deal_notes + deal_files migration; deal_notes hooks"
```

---

### Task 2: file validation + storage lib + `deal_files` hooks (TDD)

**Files:** create `lib/dealFileValidation.ts` (+test), `lib/dealFileStorage.ts` (+test), `hooks/useDealFiles.ts` (+test) under `features/pipeline/`.

- [ ] **Step 1: `dealFileValidation.ts` + test.**
```ts
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_TYPES = [
  "application/pdf", "text/csv", "text/plain",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];
export function validateFile(file: { size: number; type: string }): { ok: true } | { ok: false; reason: string } {
  if (file.size > MAX_FILE_BYTES) return { ok: false, reason: "File is larger than 10MB." };
  const ok = file.type.startsWith("image/") || ALLOWED_TYPES.includes(file.type);
  if (!ok) return { ok: false, reason: "Unsupported file type." };
  return { ok: true };
}
```
Test: accepts a 1KB image/png; rejects an 11MB pdf (size); rejects `application/x-msdownload` (type); accepts application/pdf.

- [ ] **Step 2: `dealFileStorage.ts` + test** (mirror `voiceNoteStorage.ts`).
```ts
import { supabase } from "@/lib/supabase";
const BUCKET = "deal-files";
export async function uploadDealFile(file: File, dealId: string): Promise<string> {
  const path = `${dealId}/${crypto.randomUUID()}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
  if (error) throw error;
  return path;
}
export async function signedUrlFor(path: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data) throw error ?? new Error("Could not sign deal-file URL");
  return data.signedUrl;
}
export async function removeDealFile(path: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}
```
Test (mock `@/lib/supabase` `storage.from` returning `{upload, createSignedUrl, remove}` spies): `uploadDealFile` calls upload with a `${dealId}/` path + returns it; `signedUrlFor` returns `data.signedUrl`; `removeDealFile` calls remove with `[path]`.

- [ ] **Step 3: `useDealFiles.test.tsx`** (mirror useDealContacts mock + mock `../lib/dealFileStorage`). Cover: `useDealFiles(dealId)` lists `deal_files` by deal ordered desc; `useUploadDealFile` validates (rejects bad file BEFORE uploading), else calls `uploadDealFile` then inserts a `deal_files` row `{ deal_id, path, name, size_bytes, content_type, uploaded_by }` and invalidates `["deal-files", dealId]`; `useDeleteDealFile` calls `removeDealFile(path)` then deletes the row and invalidates.

- [ ] **Step 4: implement `useDealFiles.ts`:**
```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { uploadDealFile, removeDealFile } from "../lib/dealFileStorage";
import { validateFile } from "../lib/dealFileValidation";

export interface DealFile { id: string; dealId: string; path: string; name: string; sizeBytes: number; contentType: string | null; uploadedBy: string; createdAt: string; }
interface DealFileRow { id: string; deal_id: string; path: string; name: string; size_bytes: number; content_type: string | null; uploaded_by: string; created_at: string; }
const toFile = (r: DealFileRow): DealFile => ({ id: r.id, dealId: r.deal_id, path: r.path, name: r.name, sizeBytes: r.size_bytes, contentType: r.content_type, uploadedBy: r.uploaded_by, createdAt: r.created_at });
export const DEAL_FILES_KEY = (dealId: string) => ["deal-files", dealId] as const;

export function useDealFiles(dealId: string) {
  return useQuery({
    queryKey: DEAL_FILES_KEY(dealId),
    queryFn: async (): Promise<DealFile[]> => {
      const { data, error } = await supabase.from("deal_files").select("*").eq("deal_id", dealId).order("created_at", { ascending: false });
      if (error) throw error;
      return (data as DealFileRow[]).map(toFile);
    },
    enabled: !!dealId,
  });
}
export function useUploadDealFile() {
  const qc = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  return useMutation({
    mutationFn: async ({ dealId, file }: { dealId: string; file: File }) => {
      if (!userId) throw new Error("Not signed in");
      const v = validateFile(file);
      if (!v.ok) throw new Error(v.reason);
      const path = await uploadDealFile(file, dealId);
      const { error } = await supabase.from("deal_files").insert({
        deal_id: dealId, path, name: file.name, size_bytes: file.size, content_type: file.type || null, uploaded_by: userId,
      });
      if (error) { try { await removeDealFile(path); } catch { /* best-effort orphan cleanup */ } throw error; }
    },
    onSuccess: (_r, v) => { void qc.invalidateQueries({ queryKey: DEAL_FILES_KEY(v.dealId) }); },
  });
}
export function useDeleteDealFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, path }: { id: string; dealId: string; path: string }) => {
      await removeDealFile(path);
      const { error } = await supabase.from("deal_files").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_r, v) => { void qc.invalidateQueries({ queryKey: DEAL_FILES_KEY(v.dealId) }); },
  });
}
```

- [ ] **Step 5: run** `pnpm test dealFileValidation dealFileStorage useDealFiles` → PASS. `pnpm typecheck` → clean. **Commit:**
```bash
git add apps/app/src/features/pipeline/lib/dealFileValidation.ts apps/app/src/features/pipeline/lib/dealFileValidation.test.ts apps/app/src/features/pipeline/lib/dealFileStorage.ts apps/app/src/features/pipeline/lib/dealFileStorage.test.ts apps/app/src/features/pipeline/hooks/useDealFiles.ts apps/app/src/features/pipeline/hooks/useDealFiles.test.tsx
git commit -m "feat(pipeline): deal file validation + storage lib + deal_files hooks"
```

---

### Task 3: `NotesAndFilesTab` UI + wiring (TDD)

**Files:** create `components/NotesAndFilesTab.tsx` (+test); modify `pages/DealDetailPage.tsx` (+ a test).

- [ ] **Step 1: `NotesAndFilesTab.test.tsx`** — mock `../hooks/useDealNotes` + `../hooks/useDealFiles` (and their mutation hooks → capturable `mutateAsync` spies), and `../lib/dealFileStorage` `signedUrlFor`. Build a `deal` from `MOCK_DEALS[0]`; wrap in `MemoryRouter` + `QueryClientProvider`. Assert: (a) typing a note + clicking "Add note" calls the create-note `mutateAsync` with `{ dealId, body }`; (b) note feed renders mocked notes + empty state when none; (c) file list renders mocked files (name + formatted size); (d) selecting an oversize/disallowed file (fire a change with a `File` whose size>10MB or bad type) shows a reject toast and does NOT call upload. Add jsdom polyfills if a control needs them.

- [ ] **Step 2: run** `pnpm test NotesAndFilesTab` → FAIL. **Step 3: implement `NotesAndFilesTab.tsx`** (props `{ deal: Deal }`), mirroring `ContactsTab.tsx` structure:
  - **Notes** section: a `NotesFieldWithMic` (or `Textarea`) bound to local `body` state + an "Add note" `Button` (disabled when `body.trim()===""`/pending) → `useCreateDealNote().mutateAsync({ dealId: deal.id, body })` then clear; on error toast. Feed: `useDealNotes(deal.id)` → cards (body, author id/display, relative time via the existing date helper) newest-first; Delete on each (confirm → `useDeleteDealNote`), toast on error. Empty + loading states.
  - **Files** section: a hidden `<input type="file">` + an "Upload file" `Button` that opens it; on change, take the file, `validateFile` (toast `reason` on reject, clear input, return), else `useUploadDealFile().mutateAsync({ dealId: deal.id, file })`; toast on error. List: `useDealFiles(deal.id)` → rows (name, formatted size [a small `formatBytes` helper], uploaded-by, date) with **Download** (`signedUrlFor(path)` → `window.open(url, "_blank")`) and **Delete** (confirm → `useDeleteDealFile({ id, dealId, path })`). Empty + loading states.
  - Reuse `Button`, `NotesFieldWithMic`/`Textarea`, `Card` from `@/components/navigatr`; `toast` from sonner.

- [ ] **Step 4: run** `pnpm test NotesAndFilesTab` → PASS.

- [ ] **Step 5: wire into `DealDetailPage.tsx`** — replace the Notes & Files `PlaceholderTab` with `<NotesAndFilesTab deal={deal} />`; import it. Remove the `PlaceholderTab` import IF nothing else uses it now (Contacts already replaced its use; confirm via grep — if Notes & Files was the last user, remove it). Add/extend a DealDetailPage test: the Notes & Files tab renders the composer (not "Coming in sprint 2"); mock the notes/files hooks to empty.

- [ ] **Step 6: run** `pnpm typecheck && pnpm test` (full) → clean, all green. **Commit:**
```bash
git add apps/app/src/features/pipeline/components/NotesAndFilesTab.tsx apps/app/src/features/pipeline/components/NotesAndFilesTab.test.tsx apps/app/src/features/pipeline/pages/DealDetailPage.tsx apps/app/src/features/pipeline/pages/DealDetailPage*.test.tsx
git commit -m "feat(pipeline): NotesAndFilesTab + wire into Deal Detail"
```

---

## Notes for the implementer

- `org_id` is NEVER sent for deal_notes/deal_files — triggers derive it. Inserts pass `deal_id`,
  `created_by`/`uploaded_by` (self), and the fields.
- Mirror the supabase mock from `useDealContacts.test.tsx` for hook tests; mock the storage lib in
  the files-hook + component tests (don't hit real storage / `crypto.randomUUID` is fine in jsdom).
- Reuse navigatr components; don't restyle. Keep notes append-only (no edit).
- Migration + bucket are hand-applied after merge (not run in CI/tests).
