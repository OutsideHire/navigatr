/**
 * PartnerNotesCard — the append-only notes feed on the partner detail page.
 *
 * Any teammate can add a note; a note is NOT contact (doesn't touch the
 * partner's cadence). Delete is gated to the author + managers/admins with a
 * two-tap confirm. Authors can edit their own notes; a two-tap Delete is gated
 * to author + managers/admins.
 */

import * as React from "react";
import { toast } from "sonner";
import { Plus, Check, Pencil, StickyNote } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button, Card, Textarea } from "@/components/navigatr";
import { useAuth } from "@/stores/auth";
import { useProfile } from "@/features/auth/useProfile";
import { usePartnerNotes } from "../hooks/usePartnerNotes";
import { useAddPartnerNote } from "../hooks/useAddPartnerNote";
import { useDeletePartnerNote } from "../hooks/useDeletePartnerNote";
import { useUpdatePartnerNote } from "../hooks/useUpdatePartnerNote";
import { canDeleteNote, canEditNote, isNoteEdited, formatNoteTimestamp } from "../partnerNotes";

export function PartnerNotesCard({ partnerId }: { partnerId: string }) {
  const notes = usePartnerNotes(partnerId);
  const add = useAddPartnerNote();
  const del = useDeletePartnerNote();
  const upd = useUpdatePartnerNote();
  const userId = useAuth((s) => s.user?.id);
  const role = useProfile().data?.role;

  const [composing, setComposing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [confirmId, setConfirmId] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editDraft, setEditDraft] = React.useState("");

  // Two-tap delete: first tap arms, auto-disarms after ~4s.
  React.useEffect(() => {
    if (!confirmId) return;
    const t = window.setTimeout(() => setConfirmId(null), 4000);
    return () => window.clearTimeout(t);
  }, [confirmId]);

  const list = notes.data ?? [];

  const handleAdd = async () => {
    const body = draft.trim();
    if (!body) return;
    try {
      await add.mutateAsync({ partnerId, body });
      toast.success("Note added");
      setDraft("");
      setComposing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add note");
    }
  };

  const handleDelete = async (noteId: string) => {
    if (confirmId !== noteId) {
      setConfirmId(noteId);
      return;
    }
    try {
      await del.mutateAsync({ noteId, partnerId });
      toast.success("Note deleted");
      setConfirmId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete note");
      setConfirmId(null);
    }
  };

  const startEdit = (id: string, body: string) => {
    setEditingId(id);
    setEditDraft(body);
  };

  const handleUpdate = async (id: string, original: string) => {
    const body = editDraft.trim();
    if (!body) return;
    if (body === original) {
      setEditingId(null);
      return;
    }
    try {
      await upd.mutateAsync({ noteId: id, partnerId, body });
      toast.success("Note updated");
      setEditingId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update note");
    }
  };

  return (
    <Card padding="md">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-body-strong text-text-default">Notes · {list.length}</h2>
        {!composing && (
          <Button variant="tertiary" size="sm" leadingIcon={Plus} onClick={() => setComposing(true)}>
            Add note
          </Button>
        )}
      </div>

      {composing && (
        <div className="mb-4 flex flex-col gap-3 rounded-radius-md border border-border-subtle bg-surface-sunken p-3">
          <Textarea
            id={`partner-note-new-${partnerId}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="Jot a quick note — a reminder, an observation, something worth remembering."
            className="w-full"
          />
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              leadingIcon={Check}
              onClick={handleAdd}
              disabled={add.isPending || !draft.trim()}
            >
              {add.isPending ? "Saving…" : "Save note"}
            </Button>
            <Button
              variant="tertiary"
              size="sm"
              onClick={() => {
                setDraft("");
                setComposing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {notes.isLoading && (
        <div className="flex h-20 items-center justify-center text-caption text-text-muted">
          Loading notes…
        </div>
      )}
      {notes.isError && (
        <div className="rounded-radius-md bg-status-danger-bg p-3 text-body-sm text-status-danger">
          Couldn&apos;t load notes. Refresh to try again.
        </div>
      )}
      {!notes.isLoading && !notes.isError && list.length === 0 && (
        <p className="text-body-md text-text-muted">
          No notes yet. {composing ? "Save your first one above." : "Click “Add note” to record one."}
        </p>
      )}
      {list.length > 0 && (
        <div className="flex flex-col gap-2">
          {list.map((n) => {
            const who = n.createdBy === userId ? "You" : (n.authorName ?? "Teammate");
            const canDelete = canDeleteNote(n, userId, role);
            const canEdit = canEditNote(n, userId);
            const editing = editingId === n.id;
            return (
              <div
                key={n.id}
                className="flex items-start gap-3 rounded-radius-md border border-border-subtle bg-surface-default p-3"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-radius-full bg-accent-violet-20 text-accent-violet">
                  <StickyNote className="h-4 w-4" aria-hidden />
                </span>
                {editing ? (
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <Textarea
                      id={`partner-note-edit-${n.id}`}
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      rows={3}
                      className="w-full"
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        leadingIcon={Check}
                        onClick={() => handleUpdate(n.id, n.body)}
                        disabled={upd.isPending || !editDraft.trim()}
                      >
                        {upd.isPending ? "Saving…" : "Save"}
                      </Button>
                      <Button variant="tertiary" size="sm" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <p className="whitespace-pre-wrap text-body-md text-text-default">{n.body}</p>
                      <span className="text-caption text-text-subtle">
                        {who} · {formatNoteTimestamp(n.createdAt)}
                        {isNoteEdited(n) && " · edited"}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {canEdit && (
                        <Button
                          variant="tertiary"
                          size="sm"
                          leadingIcon={Pencil}
                          onClick={() => startEdit(n.id, n.body)}
                          className="text-text-muted"
                        >
                          Edit
                        </Button>
                      )}
                      {canDelete && (
                        <Button
                          variant="tertiary"
                          size="sm"
                          onClick={() => handleDelete(n.id)}
                          disabled={del.isPending}
                          className={cn(
                            confirmId === n.id ? "text-status-danger hover:text-status-danger" : "text-text-muted",
                          )}
                        >
                          {confirmId === n.id ? "Confirm" : "Delete"}
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export default PartnerNotesCard;
