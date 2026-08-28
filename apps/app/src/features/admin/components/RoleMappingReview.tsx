/**
 * RoleMappingReview — the CSV import "review and map roles" step.
 *
 * After upload, instead of hard-failing unfamiliar role values, we group the
 * file by its distinct role values and let the admin map each one to a navigatr
 * level. Recognized values (label or code) arrive auto-selected; anything else
 * needs a deliberate pick before invites can be sent. Rows with a real problem
 * (missing / invalid / duplicate email) are surfaced as a skip list. All the
 * decision logic lives in ../utils/roleMapping (pure, unit-tested); this owns
 * only the UI + the mapping state, and hands the applied invite rows to onConfirm.
 */
import * as React from "react";
import { AlertTriangle, Check, Info } from "lucide-react";
import { Button, Select } from "@/components/navigatr";
import { ROLE_LEVEL_OPTIONS } from "@/features/auth/capabilities";
import type { ParsedAgent, ParseError } from "../utils/parseAgentsCsv";
import type { InviteInput } from "../hooks/useAdminBulkInvite";
import {
  distinctRoleTexts,
  roleTextCounts,
  initialRoleMapping,
  allRolesMapped,
  applyRoleMapping,
  type RoleMapping,
} from "../utils/roleMapping";

interface Props {
  valid: ParsedAgent[];
  errors: ParseError[];
  onBack: () => void;
  onConfirm: (rows: InviteInput[]) => void;
}

const ROLE_OPTIONS = ROLE_LEVEL_OPTIONS.map((o) => ({ value: o.value, label: o.label }));

const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

export function RoleMappingReview({ valid, errors, onBack, onConfirm }: Props) {
  const distinct = React.useMemo(() => distinctRoleTexts(valid), [valid]);
  const counts = React.useMemo(() => roleTextCounts(valid), [valid]);
  const [mapping, setMapping] = React.useState<RoleMapping>(() => initialRoleMapping(valid));

  const ready = allRolesMapped(distinct, mapping);
  const unmatched = distinct.filter((t) => mapping[t] == null).length;

  const setRole = (roleText: string, value: string) =>
    setMapping((m) => ({ ...m, [roleText]: value as RoleMapping[string] }));

  return (
    <div className="space-y-4">
      <div className="rounded-radius-md bg-surface-sunken p-4">
        <div className="text-body-strong">{people(valid.length)} found in your file.</div>
        <div className="mt-1 text-body-md text-text-muted">
          Match each role to a navigatr level, then send the invites.
        </div>
      </div>

      {distinct.length > 0 && (
        <div className="rounded-radius-md border border-border-subtle">
          <div className="border-b border-border-subtle px-4 py-2 text-caption text-text-muted">
            Roles found in your file
          </div>
          <ul>
            {distinct.map((roleText) => {
              const mapped = mapping[roleText];
              return (
                <li
                  key={roleText}
                  className="flex items-center gap-3 border-b border-border-subtle px-4 py-3 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-body-strong text-text-default">{roleText || "No role given"}</div>
                    <div className="text-caption text-text-muted">{people(counts[roleText] ?? 0)}</div>
                  </div>
                  <div className="w-52 shrink-0">
                    <Select
                      aria-label={`Map ${roleText || "no role given"}`}
                      options={ROLE_OPTIONS}
                      value={mapped ?? undefined}
                      onValueChange={(v) => setRole(roleText, v)}
                      placeholder="Choose a level"
                      size="sm"
                      state={mapped ? undefined : "error"}
                    />
                  </div>
                  {mapped ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-radius-full bg-status-success-bg px-2 py-0.5 text-caption text-status-success">
                      <Check className="h-3 w-3" aria-hidden /> Matched
                    </span>
                  ) : (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-radius-full border border-status-warning px-2 py-0.5 text-caption text-status-warning">
                      <AlertTriangle className="h-3 w-3" aria-hidden /> Needs a match
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {errors.length > 0 && (
        <details className="rounded-radius-md border border-border-subtle p-3">
          <summary className="cursor-pointer text-body-md text-text-muted">
            <Info className="mr-1 inline h-4 w-4 align-[-2px]" aria-hidden />
            {errors.length} {errors.length === 1 ? "row" : "rows"} will be skipped (missing, invalid, or duplicate email)
          </summary>
          <ul className="mt-2 max-h-48 overflow-y-auto text-caption text-text-muted">
            {errors.slice(0, 100).map((e, i) => (
              <li key={i}>
                Row {e.row}: {e.reason} ({e.raw})
              </li>
            ))}
            {errors.length > 100 && <li>… and {errors.length - 100} more</li>}
          </ul>
        </details>
      )}

      <div className="flex items-center justify-between gap-3">
        <Button variant="tertiary" size="md" onClick={onBack}>
          Choose a different file
        </Button>
        <div className="flex items-center gap-3">
          {/* Persistent live region so the blocking reason (and its clearing
              when the last role is mapped) is announced, not just shown. */}
          <span className="text-caption text-status-warning" role="status" aria-live="polite">
            {!ready && (
              <>
                <AlertTriangle className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />
                {unmatched} {unmatched === 1 ? "role" : "roles"} still {unmatched === 1 ? "needs" : "need"} a match
              </>
            )}
          </span>
          <Button
            variant="primary"
            size="md"
            disabled={!ready || valid.length === 0}
            onClick={() => onConfirm(applyRoleMapping(valid, mapping))}
          >
            Send {valid.length} {valid.length === 1 ? "invite" : "invites"}
          </Button>
        </div>
      </div>
    </div>
  );
}
