/**
 * NotesAndFilesTab — the Notes & Files tab body on the Deal detail page.
 *
 * Two sections:
 *   - Notes: a composer (NotesFieldWithMic) + a newest-first feed backed by
 *     useDealNotes. Each note shows body, author and a short date, with a
 *     per-note Delete.
 *   - Files: a hidden file input + "Upload file" button (validated client-side
 *     via validateFile), and a list of uploaded files backed by useDealFiles
 *     with Download (signed URL) and Delete per row.
 */

import { useRef, useState } from "react";
import { Download, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button, Card, NotesFieldWithMic } from "@/components/navigatr";
import { formatShortDate, type Deal } from "../mockData";
import {
  useDealNotes,
  useCreateDealNote,
  useDeleteDealNote,
} from "../hooks/useDealNotes";
import {
  useDealFiles,
  useUploadDealFile,
  useDeleteDealFile,
} from "../hooks/useDealFiles";
import { validateFile } from "../lib/dealFileValidation";
import { signedUrlFor } from "../lib/dealFileStorage";

export interface NotesAndFilesTabProps {
  deal: Deal;
}

/** Human-readable byte size: B / KB / MB. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-caption font-medium uppercase tracking-wide text-text-muted">
      {children}
    </span>
  );
}

function NotesSection({ deal }: { deal: Deal }) {
  const { data, isLoading } = useDealNotes(deal.id);
  const createNote = useCreateDealNote();
  const deleteNote = useDeleteDealNote();
  const [body, setBody] = useState("");

  const notes = data ?? [];
  const canSubmit = body.trim() !== "" && !createNote.isPending;

  const handleAdd = async () => {
    const trimmed = body.trim();
    if (trimmed === "") return;
    try {
      await createNote.mutateAsync({ dealId: deal.id, body: trimmed });
      setBody("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add note — please try again.");
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this note?")) return;
    try {
      await deleteNote.mutateAsync({ id, dealId: deal.id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete note — please try again.");
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <Eyebrow>Notes</Eyebrow>

      <div className="flex flex-col gap-2">
        <NotesFieldWithMic
          value={body}
          onChange={setBody}
          placeholder="Add a note about this deal"
          disabled={createNote.isPending}
        />
        <div className="flex justify-end">
          <Button
            type="button"
            variant="primary"
            size="sm"
            leadingIcon={Plus}
            disabled={!canSubmit}
            onClick={handleAdd}
          >
            Add note
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="py-4 text-center text-body-sm text-text-muted">Loading notes…</p>
      ) : notes.length === 0 ? (
        <p className="py-6 text-center text-body-sm text-text-muted">No notes yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {notes.map((note) => (
            <li key={note.id}>
              <Card padding="md" className="flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="whitespace-pre-wrap text-body-md text-text-default">{note.body}</p>
                  <Button
                    type="button"
                    variant="tertiary"
                    size="sm"
                    iconOnly
                    leadingIcon={Trash2}
                    aria-label="Delete note"
                    onClick={() => handleDelete(note.id)}
                  />
                </div>
                <div className="flex items-center gap-2 text-caption text-text-muted">
                  <span>{note.createdBy}</span>
                  <span aria-hidden>·</span>
                  <span>{formatShortDate(note.createdAt)}</span>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FilesSection({ deal }: { deal: Deal }) {
  const { data, isLoading } = useDealFiles(deal.id);
  const uploadFile = useUploadDealFile();
  const deleteFile = useDeleteDealFile();
  const inputRef = useRef<HTMLInputElement>(null);

  const files = data ?? [];

  const resetInput = () => {
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const v = validateFile(file);
    if (!v.ok) {
      toast.error(v.reason);
      resetInput();
      return;
    }
    try {
      await uploadFile.mutateAsync({ dealId: deal.id, file });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't upload file — please try again.");
    }
    resetInput();
  };

  const handleDownload = async (path: string) => {
    try {
      const url = await signedUrlFor(path);
      window.open(url, "_blank", "noopener");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open file — please try again.");
    }
  };

  const handleDelete = async (id: string, path: string) => {
    if (!window.confirm("Delete this file?")) return;
    try {
      await deleteFile.mutateAsync({ id, dealId: deal.id, path });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete file — please try again.");
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Eyebrow>Files</Eyebrow>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          aria-hidden
          onChange={handleChange}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          leadingIcon={Upload}
          disabled={uploadFile.isPending}
          onClick={() => inputRef.current?.click()}
        >
          Upload file
        </Button>
      </div>

      {isLoading ? (
        <p className="py-4 text-center text-body-sm text-text-muted">Loading files…</p>
      ) : files.length === 0 ? (
        <p className="py-6 text-center text-body-sm text-text-muted">No files yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {files.map((file) => (
            <li key={file.id}>
              <Card padding="md" className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <span className="text-body-md font-medium text-text-default">{file.name}</span>
                  <div className="flex flex-wrap items-center gap-2 text-caption text-text-muted">
                    <span>{formatBytes(file.sizeBytes)}</span>
                    <span aria-hidden>·</span>
                    <span>{file.uploadedBy}</span>
                    <span aria-hidden>·</span>
                    <span>{formatShortDate(file.createdAt)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="tertiary"
                    size="sm"
                    iconOnly
                    leadingIcon={Download}
                    aria-label={`Download ${file.name}`}
                    onClick={() => handleDownload(file.path)}
                  />
                  <Button
                    type="button"
                    variant="tertiary"
                    size="sm"
                    iconOnly
                    leadingIcon={Trash2}
                    aria-label={`Delete ${file.name}`}
                    onClick={() => handleDelete(file.id, file.path)}
                  />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function NotesAndFilesTab({ deal }: NotesAndFilesTabProps) {
  return (
    <div className="flex flex-col gap-6">
      <NotesSection deal={deal} />
      <FilesSection deal={deal} />
    </div>
  );
}

export default NotesAndFilesTab;
