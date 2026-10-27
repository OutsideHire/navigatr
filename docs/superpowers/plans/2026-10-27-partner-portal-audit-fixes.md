# Partner Portal PRD Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every gap from the 2026-10 requirement-by-requirement PRD audit that Robert approved on 2026-10-27, so the portal matches his PRD before any ISO turns it on.

**Architecture:** Four PRs to `main` (staging), merged in order. Each is a mix of SQL migrations (SECURITY DEFINER RPCs, search_path pinned, explicit revoke/grant, the house pattern), edge-function changes in `supabase/functions/_shared/`, and React changes in `apps/app/src/features/{partners,portal,settings-hub,admin,pipeline}`. No new services.

**Tech Stack:** Supabase Postgres + pg_cron, Deno edge functions, React 19 + TanStack Query + vitest, psql DB tests via `./tools/run-db-tests.sh`.

**Spec:** `docs/superpowers/specs/2026-10-07-partner-portal-design.md` plus Robert's PRD 6.x (FR-PORT-nn). The decisions below come from the audit email and Robert's answers (2026-10-27); where they differ from the spec, this plan wins.

## Global Constraints

- Never use em or en dashes in any user-facing copy, comments included where they ship as copy. Use periods, commas, or parentheses.
- Partners never see internal statuses, decline reasons, internal notes, or stage names. `apps/app/src/features/portal/portalStringAudit.test.tsx` must stay green and gain coverage for every new partner payload field.
- Every new SQL function: `security definer`, `set search_path = public, extensions`, `revoke execute ... from public, anon, authenticated`, then grant only to the role that calls it. Use `extensions.gen_random_bytes` if needed.
- Changing a function's return type or arguments needs `drop function` then `create`, then re-grant. Same-signature changes use `create or replace`.
- Outbox kinds are a text CHECK (`portal_email_outbox_kind_check`). Any task adding a kind drops and re-adds the check with the FULL current list (latest list: `20261022000002_referral_sent_to_partner.sql:26-41`, plus kinds added by earlier tasks in this plan).
- Internal email payloads have exactly three keys: `{appUrlPath, companyNames, count}`.
- Enqueue calls inside RPCs are wrapped in `begin ... exception when others then raise warning ... end` so email never blocks the action.
- Migrations: PR1 `20261027000001..`, PR2 `20261028000001..`, PR3 `20261029000001..`, PR4 `20261030000001..`. DB tests take the next free number starting at `067_`.
- Employee count values (portal and app, stored text): `'1-10'`, `'11-50'`, `'51-200'`, `'201+'`. Labels: "1 to 10", "11 to 50", "51 to 200", "Over 200".
- Before each PR: `pnpm --filter app test`, `./tools/run-db-tests.sh`, edge tests (`deno test supabase/functions/_shared`), and a real `pnpm build`.

## Decisions taken in this plan (not in the PRD text)

1. FR-PORT-45 (reviewer duplicate warning visibility) moves OUT of this plan into the separate hierarchy-aware duplicates project, together with deal-creation dedupe. Ryan approved 2026-10-27.
2. Name-only soft match when no address (Q3) is already built (`_portal_find_duplicates`, `form_submission_advice`, the `name` tier of `find_place_duplicate_candidates`) and never blocks. No task.
3. Address standardizing (Q12) is already built (`deal_dedupe_key`). No task.
4. Withdraw (partner asked) on an accepted or working referral keeps the deal but removes the partner's credit (`deals.source_partner_id` cleared), mirroring `remove_referral_link`.
5. Company link (tenant) attribution routes the referral to `referral_route_assignee(partner)` and ends the reviewer's flow. The rep then accepts, declines, or merges. If routing returns NULL the reviewer keeps it. Personal-link attribution is unchanged (reviewer keeps it).
6. Reply-To: sign-in code, weekly digest, and public-form confirmation use `NO_REPLY_ADDRESS` (env, default `no-reply@send.getnavigatr.io`). Invites reply to the inviting rep. Referral status and "sent to you" emails keep replying to the rep (spec 304-306).
7. Closed Won count and value use the close date; Submitted, Active, Not Moving Forward and the conversion rate keep the sent date (conversion uses a sent-date won count so its numerator and denominator share a cohort).
8. App Add/Edit Deal employee-count pickers switch to the four shared values; existing rows are remapped (`1-9`→`1-10`, `10-49`→`11-50`, `50-249`→`51-200`, `250+`→`201+`). This is an approximation at the edges and is accepted.
9. "Powered by navigatr" in partner-facing emails follows `org_branding.show_powered_by`; an admin switch is added to the Partner Portal settings. The rep-facing app line in `AppLayout.tsx` stays locked.

## Review Focus

1. A referral reassigned to a rep outside the reviewer's subtree (or routed by the company link): the reviewer's sheet must close cleanly, never call a follow-on RPC that fails with `not_authorized`. Test in Task 5.
2. Reassign history rows (from = to status) must never reach the partner's history. Test in Task 15.
3. A declined referral with a partner message must send exactly ONE partner email, and the internal note must never be in it. Test in Task 11.
4. A partner whose terms are out of date mid-session: referral actions return `terms_required` and the app shows the accept page, not a generic error. Test in Task 13.
5. The 75-day warning must not repeat on every 2-minute drain and must respect each org's `declined_retention_days`. Test in Task 22.

---

## PR 1: Triage and duplicates

### Task 1: "Referral form" lead source (FR-PORT-32)

**Files:**
- Create: `supabase/migrations/20261027000001_referral_form_lead_source.sql`
- Modify: `apps/app/src/features/pipeline/lib/leadSources.ts`, `apps/app/src/features/dashboard/lib/leadSourcePerformance.ts:267-279`, `apps/app/src/features/partners/components/ReviewFormSubmissionSheet.tsx:12` (comment)
- Test: `supabase/tests/060_form_submission_triage.sql:261`, `apps/app/src/features/pipeline/lib/leadSources.test.ts`, `apps/app/src/features/dashboard/lib/leadSourcePerformance.test.ts`, `ReviewFormSubmissionSheet.test.tsx:141`

**Interfaces:** Produces lead source value `'referral_form'` (label "Referral form").

- [ ] Update `060` to assert a no-partner accepted submission's deal has `lead_source = 'referral_form'`; add a leadSources test that `referral_form` is system-set, not rep-pickable, not rep-sourced. Run both, expect FAIL.
- [ ] Migration: drop/re-add `deals_lead_source_check` with the full list from `20260808000003_add_deal_places_foundation.sql:25-30` plus `referral_form`; `create or replace accept_form_submission` (same signature, from `20261020000002:164-193`) setting `'referral_form'` instead of `'inbound'`. Do not touch already-created deals.
- [ ] Register the value in `LEAD_SOURCE_VALUES`, `LEAD_SOURCE_LABEL`, `SYSTEM_SET_SOURCES`, `LEAD_SOURCE_COLOR`, `LEAD_SOURCE_BLURB` (blurb: "Sent through your referral form with no partner credited."). Change the `partner_referral` blurb to drop "or partner form".
- [ ] Run tests, expect PASS. Commit.

### Task 2: First referral wins for public-form submissions (FR-PORT-46, 47, 49)

**Files:**
- Create: `supabase/migrations/20261027000002_form_submission_first_wins.sql`
- Modify: `apps/app/src/features/partners/components/ReviewFormSubmissionSheet.tsx`, `apps/app/src/features/partners/hooks/useFormSubmissionMutations.ts`
- Test: `supabase/tests/060_form_submission_triage.sql` (section 5), `ReviewFormSubmissionSheet.test.tsx`

**Interfaces:**
- Produces: `attribute_form_submission(p_submission_id uuid, p_partner_id uuid) returns table(referral_id uuid, duplicate_of_referral_id uuid, duplicate_of_deal_id uuid, assigned_user_id uuid)` (drop + create + grant authenticated). Task 5 extends the same function in the same migration file.
- Consumes: `_portal_find_duplicates(p_org, p_partner, p_name, p_phone, p_address, p_exclude)` (latest `20261016000003:129-178`).

- [ ] DB test: attributing a submission whose phone matches an earlier live referral from another partner stores `duplicate_of_referral_id`, and `accept_referral` then raises `override_reason_required`. Expect FAIL.
- [ ] Recreate `attribute_form_submission` calling `_portal_find_duplicates(s.org_id, p_partner_id, s.company_name, s.contact_phone, null, null)` and storing both columns on insert.
- [ ] Sheet: after attribution, if either duplicate column is set, enter the same flagged state as `ReviewReferralSheet` (Decline (duplicate) preselected, an "override" mode requiring a reason that calls `useAcceptReferral({referralId, overrideReason})`). Add Mode `"override"` to the union at `:46`. Copy the warning text from `ReviewReferralSheet.tsx:217-221`.
- [ ] Vitest: flagged attribution shows the warning and requires a reason to accept. Run all, expect PASS. Commit.

### Task 3: Merging a flagged duplicate requires a reason (FR-PORT-47)

**Files:**
- Create: `supabase/migrations/20261027000003_merge_referral_override.sql`
- Modify: `apps/app/src/features/partners/hooks/useReferralMutations.ts:108-120`, `ReviewReferralSheet.tsx:304-328`, `ReviewFormSubmissionSheet.tsx` (merge mode for flagged attributed referrals)
- Test: `supabase/tests/044_accept_referral_override.sql`, `ReviewReferralSheet.test.tsx:244`

**Interfaces:** Produces `merge_referral_override(p_referral_id uuid, p_deal_id uuid, p_reason text) returns void` (authenticated). `useMergeReferral` input gains `overrideReason?: string`.

- [ ] DB tests: `merge_referral` on a flagged referral raises `override_reason_required`; `merge_referral_override` with a blank reason raises it too; with a reason it merges and history note is `Merged despite possible duplicate: <reason>` (max 500 chars). Expect FAIL.
- [ ] `create or replace merge_referral` (same signature, `20261007000003:253-285`) adding the guard used by `accept_referral` (`20261012000005:26-29`); add `merge_referral_override` mirroring `accept_referral_override`.
- [ ] First partner keeps credit (Q2): DB test that `merge_referral_override` of partner B's flagged referral into a deal whose `source_partner_id` is partner A leaves `source_partner_id = A` and ends B's referral `declined` with reason `duplicate` (B sees Not Moving Forward, never Accepted or Closed Won). Expect FAIL, implement in `merge_referral_override`, PASS.
- [ ] UI: merge mode for flagged rows shows a required reason textarea. Flip the test at `:244` to "requires a reason to merge a flagged referral". PASS. Commit.

### Task 4: "Already a customer" warning, rep only (FR-PORT-44, Q4)

**Files:**
- Create: `supabase/migrations/20261027000004_referral_customer_match.sql`, `apps/app/src/features/partners/hooks/useCustomerMatch.ts`
- Modify: `ReviewReferralSheet.tsx:223-227`, `ReviewFormSubmissionSheet.tsx:311-320`
- Test: new `supabase/tests/067_referral_customer_match.sql`, `useCustomerMatch.test.tsx`, both sheet tests

**Interfaces:** Produces `referral_customer_match(p_company text, p_phone text, p_address text) returns table(deal_id uuid, company_name text)`; only `stage='won'` deals in the caller's org where `user_can_see_owner(owner_id)`; matches on phone key, name+address key, or name key when address is blank (reuse `deal_phone_key`, `deal_dedupe_key`, `deal_name_key`); limit 1, newest first. `useCustomerMatch({company, phone, address}) -> {data: {dealId, companyName} | null}`.

- [ ] DB test: a won deal the caller can see matches; a won deal owned outside the caller's subtree does NOT match; an open deal does not match. Expect FAIL. Implement. PASS.
- [ ] Sheets show "Already a customer: {company} was closed won." linking to the deal. Nothing changes on the portal side (`042` won fixture stays). Commit.

### Task 5: Company link routes to the partner's rep (FR-PORT-51)

**Files:**
- Modify: `supabase/migrations/20261027000002_form_submission_first_wins.sql` (same `attribute_form_submission`), `ReviewFormSubmissionSheet.tsx:191-248`
- Test: `060` section 5, `ReviewFormSubmissionSheet.test.tsx`

**Interfaces:** Consumes `referral_route_assignee(p_partner uuid) returns uuid` (`20261018000002:66-69`), `_portal_enqueue_new_referral(p_referral referrals)` (`20261014000003:99-111`).

- [ ] DB tests: tenant-link submission attributed by an admin to a partner owned by RepA gets `assigned_user_id = RepA` and an `internal_new_referral` outbox row for RepA; routing NULL keeps the reviewer; personal-link attribution still keeps the reviewer (update the existing assertion only for the tenant case). Expect FAIL.
- [ ] In the function: when `s.link_type = 'tenant'`, assign `coalesce(referral_route_assignee(p_partner_id), auth.uid())`, and when that is not the caller, call `_portal_enqueue_new_referral` in an exception block.
- [ ] Sheet: when the returned `assigned_user_id` differs from the current user, show "Sent to {rep name}. They will review it." and close; never chain into accept, decline, or merge (Review Focus 1). Vitest for that path. PASS. Commit.

### Task 6: "Withdraw (partner asked)" for reps (FR-PORT-42, PRD 11.1)

**Files:**
- Create: `supabase/migrations/20261027000005_withdraw_referral_credit.sql`
- Modify: `apps/app/src/features/partners/hooks/useReferralMutations.ts`, `ReviewReferralSheet.tsx:229-247`, `apps/app/src/features/pipeline/pages/DealDetailPage.tsx:510-566` (SourceCard)
- Test: `supabase/tests/035_referral_rpcs.sql:168-176`, `useReferralMutations.test.tsx`, `ReviewReferralSheet.test.tsx`, `DealDetailPage.referral.test.tsx`

**Interfaces:** Consumes `withdraw_referral(p_referral_id uuid, p_note text default null)`. Produces `useWithdrawReferral() -> mutate({referralId, note?})`.

- [ ] DB test: withdrawing an accepted referral clears `deals.source_partner_id` for that deal when it points at this partner. Expect FAIL. `create or replace withdraw_referral` (same signature) adding that clear, copied from `remove_referral_link` (`20261007000003:125-163`). PASS.
- [ ] Hook + buttons: "Withdraw (partner asked)" in the review sheet (submitted) and the deal SourceCard (accepted or working), each with a confirm step and an optional internal note. Success toast "Referral withdrawn. The partner will see Withdrawn." Vitest. PASS. Commit.

### Task 7: Referring partner's name on the deal page and queue, read-only (FR-PORT-55)

**Files:**
- Create: `supabase/migrations/20261027000006_referral_partner_names.sql`, `apps/app/src/features/partners/hooks/useReferralPartnerNames.ts`
- Modify: `apps/app/src/features/partners/hooks/useDealReferral.ts`, `useReferralQueue.ts:83`, `DealDetailPage.tsx:553-563`
- Test: new `supabase/tests/068_referral_partner_names.sql`, `useDealReferral.test.tsx`, `DealDetailPage.referral.test.tsx`

**Interfaces:** Produces `referral_partner_names(p_referral_ids uuid[]) returns table(referral_id uuid, partner_id uuid, name text, company text, visible boolean)`. Returns rows only for referrals the caller could select under the referrals SELECT policy (`20261007000001:177-187`, mirror its predicate exactly); `visible = can_see_partner(partner_id)`.

- [ ] DB test: rep who owns the deal but cannot see the partner gets the name with `visible=false`; a rep who cannot see the referral gets no row. Expect FAIL. Implement. PASS.
- [ ] Deal page shows "Referred by {name} ({company})", linked only when `visible`; queue rows use the same name. Vitest. PASS. Commit. Open PR 1.

---

## PR 2: What partners see

### Task 8: Status filter on the partner's list (FR-PORT-75)

**Files:** Modify `apps/app/src/features/portal/pages/PortalDashboardPage.tsx:126-200`. Test `PortalDashboardPage.test.tsx`.

- [ ] Test: chips "All", "Received", "Accepted", "In Progress", "Closed Won", "Not Moving Forward", "Withdrawn" filter the rendered list by `label`, client-side; "All" is default; chips with zero rows still render; the CSV export is unchanged. Expect FAIL. Implement. PASS. Commit.

### Task 9: Closed Won by close date (FR-PORT-70, Q7)

**Files:** Create `supabase/migrations/20261028000001_portal_stats_close_date.sql`. Modify `supabase/functions/_shared/portalReferralApi.ts:314-333`. Test `supabase/tests/052_portal_reads_include_purged.sql`, `portalReferralApi.test.ts` "dashboard".

**Interfaces:** `portal_dashboard_stats(p_org, p_partner, p_since)` (drop + create + re-grant service_role) returns `(submitted, active, closed_won, not_moving_forward, won_value_cents, value_visible, won_sent)`. `closed_won` and `won_value_cents`: `r.status='won' and d.closed_won_at >= p_since`; `won_sent`: won and `submitted_at >= p_since`. Other columns unchanged.

- [ ] DB test: a referral sent 13 months ago and won last month counts in 12m Closed Won and value, not in `won_sent`. Expect FAIL. Implement. Edge `conversionRate = won_sent / (won_sent + not_moving_forward)`. PASS. Commit.

### Task 10: Closed value on the referral's own page (FR-PORT-71, 11.2)

**Files:** Create `supabase/migrations/20261028000002_portal_referral_value.sql`. Modify `portalReferralApi.ts:112-132, 335-399`, `apps/app/src/features/portal/lib/portalApi.ts`, `apps/app/src/features/portal/pages/PortalReferralPage.tsx:127-135`. Test `portalReferralApi.test.ts` "get_referral", `PortalReferralPage.test.tsx`, `portalStringAudit.test.tsx`.

**Interfaces:** `portal_referral_value(p_org uuid, p_partner uuid, p_referral uuid) returns bigint` (service_role): `d.value_cents` only when status won and `partner_value_visibility`, else NULL. `PortalReferralDetail.closedWonValueCents: number | null`.

- [ ] Tests: value shows as "Closed value: $X" (use `formatPortalMoney`) only for Closed Won with visibility on; null otherwise. Expect FAIL. Implement. PASS. Commit.

### Task 11: Rep-written message on a declined referral (FR-PORT-65, Q8)

**Files:** Create `supabase/migrations/20261028000003_decline_with_message.sql`. Modify `useReferralMutations.ts:93-103`, `ReviewReferralSheet.tsx:277-298`, `supabase/functions/_shared/portalNotifyEmail.ts:323-329`. Test `supabase/tests/045_referral_updates.sql`, new `069_decline_with_message.sql`, `portalNotifyEmail.test.ts`, `ReviewReferralSheet.test.tsx`.

**Interfaces:** `decline_referral_with_message(p_referral_id uuid, p_reason referral_decline_reason, p_note text, p_partner_message text) returns void` (authenticated). It sets local GUC `navigatr.decline_message` (trimmed, max 1000) then calls `decline_referral`; the status-email trigger copies it into the `partner_not_moving_forward` payload as `message`; it then inserts a `referral_updates` row with local GUC `navigatr.skip_update_email = 'on'`, which `referral_updates_enqueue_email` honors by skipping.

- [ ] DB test: exactly one outbox row for the referral after the call, payload `message` equals the partner message, payload contains neither the decline reason nor the internal note; the update appears in `portal_referral_updates`. Expect FAIL. Implement (`create or replace` both triggers, same signatures). PASS.
- [ ] Builder renders the message under "A note from {org}:" when present. Sheet decline mode gains "Message to the partner (they will see this, optional)" beside the existing internal note; non-empty calls the new RPC, else the old one. Vitest. PASS. Commit.

### Task 12: Business size as employee count (FR-PORT-35, Q10)

**Files:** Create `supabase/migrations/20261028000004_employee_count_range.sql`, `apps/app/src/lib/employeeCount.ts`. Modify `PortalSubmitPage.tsx`, `PortalPublicFormPage.tsx`, `portalDraft.ts`, `portalApi.ts:101-112`, `supabase/functions/_shared/portalSubmission.ts:20-169`, `portalReferralApi.ts:260-291`, `portalPublicForm.ts:52-131, 439-452`, `AddDealSheet.tsx:146-151`, `EditDealSheet.tsx:79-84`. Tests: listed in each file's sibling test plus `042`, `058`, `060`, `044`.

**Interfaces:** `EMPLOYEE_COUNT_OPTIONS: {value: "1-10"|"11-50"|"51-200"|"201+", label: string}[]` in `apps/app/src/lib/employeeCount.ts` (app) and the same list in `portalSubmission.ts` (edge). Columns `referrals.employee_count_range` and `referral_form_submissions.employee_count_range`, text, nullable, CHECK in the four values. `portal_submit_referral` and `portal_public_submit` gain `p_employee_count text default null` (drop + create + re-grant; keep all other args in order).

- [ ] Tests first: optional "How many employees?" select on both forms; server rejects other values; value carried to the deal by `accept_referral`, `attribute_form_submission`, `accept_form_submission`; migration remaps old picker values (Decision 8). Expect FAIL. Implement. PASS. Commit.

### Task 13: Re-accept terms after they change (FR-PORT-18, Q13)

**Files:** Create `supabase/migrations/20261028000005_portal_terms_reaccept.sql`, `apps/app/src/features/portal/pages/PortalTermsPage.tsx`. Modify `supabase/functions/_shared/portalApi.ts:426, 511-535`, `apps/app/src/features/portal/components/PortalSignedInLayout.tsx`, `apps/app/src/features/portal/lib/portalApi.ts`, `PartnerPortalTab.tsx` helper copy. Tests `039_portal_sign_in.sql`, `portalApi.test.ts`, `PortalRoot.test.tsx`, new `PortalTermsPage.test.tsx`.

**Interfaces:** `portal_session_lookup` returns an added `terms_current boolean` (drop + create + re-grant). New `portal_accept_terms(p_slug text, p_token text, p_terms_version int, p_ip text) returns void` (service_role): raises `terms_changed` on version mismatch, updates `portal_users.terms_*`, audits `terms_accept`. Edge: `me` returns `termsCurrent`; actions `get_terms` and `accept_terms`; all referral actions return 403 `terms_required` when not current.

- [ ] Tests (Review Focus 4): after an admin edits terms, `me` reports `termsCurrent=false`, referral actions 403, the layout shows the terms page, accepting restores access, and a version race returns 409. Expect FAIL. Implement (reuse PortalInvitePage terms copy). Settings helper copy: "Partners accept the new version at their next sign-in." PASS. Commit.

### Task 14: One builder for every portal link (custom-domain readiness)

**Files:** Modify `apps/app/src/features/portal/lib/portalAddress.ts` and every hand-built `/p/${slug}` site listed in the grounding (`PortalRoot.tsx:70`, `PortalSignedInLayout.tsx:38,46,83`, `PortalSentSection.tsx:46`, `PortalSentReferralPage.tsx:62`, `PortalProfilePage.tsx:109`, `PortalReferralPage.tsx:51`, `PortalSignInPage.tsx:27,61`, `PortalSubmitPage.tsx:215,221,257`, `PortalInvitePage.tsx:25,49,93`, `PortalDashboardPage.tsx:130,175`); edge `portalNotifyEmail.ts:407` uses a `portalApiUrl` builder in `portalEmail.ts`. Test `portalAddress.test.ts`.

**Interfaces:** `portalPath(slug: string, sub?: string): string` (relative, `/p/<slug><sub>`); `portalOrigin(): string` (today `window.location.origin`), used by `portalAddress` and `referralFormAddress`.

- [ ] Test: `portalPath` cases, plus a source-scan test that fails if any file under `apps/app/src/features/portal` other than `portalAddress.ts` contains `` `/p/${ ``. Expect FAIL. Replace all sites. PASS. Commit. Open PR 2.

---

## PR 3: Rep lifecycle and emails

### Task 15: Referral history in the app, with reassignments (FR-PORT-60)

**Files:** Create `supabase/migrations/20261029000001_referral_history_reassign.sql`, `apps/app/src/features/partners/components/ReferralHistory.tsx`, `hooks/useReferralHistory.ts`. Modify `DealDetailPage.tsx` SourceCard, `ReviewReferralSheet.tsx`. Tests `035`, `043`, new component and hook tests.

**Interfaces:** `reassign_referral` (same signature, `create or replace`) inserts a `referral_status_history` row with `from_status = to_status = current`, actor user, note `Reassigned to <full_name>`. `portal_referral_history` (same signature) excludes rows where `from_status = to_status`. `useReferralHistory(referralId)` reads `referral_status_history` (RLS already allows) joined to actor names.

- [ ] DB test: reassign writes a history row; the partner history RPC does not return it (Review Focus 2). Expect FAIL. Implement. PASS.
- [ ] UI: collapsible "History" list (date, what happened, who) on the deal SourceCard and the review sheet. Vitest. PASS. Commit.

### Task 16: Admins give any rep a new form link (FR-PORT-27)

**Files:** Modify `apps/app/src/features/partners/hooks/useReferralLinks.ts:61-78`, `apps/app/src/features/admin/pages/AgentsPage.tsx:319-349`, `components/AgentCard.tsx:82-117`, `components/AgentListRow.tsx`. Tests `useReferralLinks.test.tsx`, AgentsPage tests.

**Interfaces:** `useRegenerateReferralLink` input gains `userId?: string` (sent as `p_user_id`). RPC already supports it (`057:150-177`).

- [ ] Tests: admin sees "New referral form link" per agent only while the public form is on; confirm step warns old links and QR codes stop working; result dialog shows the new address with copy. Expect FAIL. Implement. PASS. Commit.

### Task 17: Reminder restarts after reassign or reinstate (FR-PORT-48, 55)

**Files:** Create `supabase/migrations/20261029000002_nudge_rearm.sql`. Tests `048_portal_nudges.sql:166-173` (flip), `054_referral_reinstate.sql`, `061_form_submission_notify.sql`.

**Interfaces:** Columns `referrals.nudge_from_at timestamptz` and `referral_form_submissions.nudge_from_at timestamptz`. `enqueue_portal_nudges` (same signature) uses `coalesce(nudge_from_at, submitted_at)` for its window. `reassign_referral`, `reassign_form_submission`, `reinstate_referral` set `nudge_from_at = now()`, `nudged_at = null`, and delete that item's rows from `referral_nudges` / `form_submission_nudges`. Build on Task 15's `reassign_referral`.

- [ ] DB tests: reassigned item nudges the new rep at their next end of day; a reinstated 10-day-old referral nudges again. Expect FAIL. Implement. PASS. Commit.

### Task 18: "Assigned to you" email (FR-PORT-80)

**Files:** Create `supabase/migrations/20261029000003_internal_assigned_email.sql`. Modify `portalNotifyEmail.ts:34-40, 445-545`. Tests `046`, `061`, `035`, `060`, `portalNotifyEmail.test.ts`, `portalNotify.test.ts`.

**Interfaces:** Kind `internal_assigned`. Enqueued from `reassign_referral` and `reassign_form_submission` (build on Task 17's versions) when the new assignee differs from the old one and from the caller; dedupe key `internal_assigned:<item id>:<user id>:<epoch seconds>`; payload `{appUrlPath:'/partners', companyNames:[company], count:1}`.

- [ ] Tests: reassign to another rep queues one row; reassign to self or no change queues none; builder subject "A referral was assigned to you: {company}" with an explicit branch before the nudge fallthrough. Expect FAIL. Implement. PASS. Commit.

### Task 19: Portal sign-in address in partner email footers (FR-PORT-23)

**Files:** Modify `supabase/functions/_shared/emailTemplate.ts:98-180`, `portalEmail.ts`, `portalNotifyEmail.ts`, `portalInvite.ts`, `portalApi.ts` (code email), `portalPublicForm.ts` (confirmation). Tests `emailTemplate.test.ts`, `emailTemplate.snapshot.test.ts`, `portalEmail.test.ts`, `portalNotifyEmail.test.ts`.

**Interfaces:** `EmailOptions.portalAddress?: {url: string}`; rendered only when `brand` is set, as "Sign in to your partner portal any time: {url}" above Powered by, in HTML and text. Unbranded output byte-identical (snapshot).

- [ ] Tests: every partner email includes the line with `portalUrl(appBaseUrl, slug)`; internal emails do not. Expect FAIL. Implement. PASS. Commit.

### Task 20: Reply-To rules (FR-PORT-81, Q17)

**Files:** Create `supabase/migrations/20261029000004_invite_returns_inviter.sql`. Modify `portalApi.ts:32-38, 336-351`, `portalInvite.ts:113-119`, `portalPublicForm.ts:479`, `portalNotifyEmail.ts:441`, the three function `index.ts` env reads. Tests `portalApi.test.ts`, `portalInvite.test.ts`, `portalNotify.test.ts`, `038_portal_invites.sql`.

**Interfaces:** `PortalEmailMessage.replyTo: string | null`. `portal_create_invite` returns added `inviter_email text` (drop + create + re-grant service_role). Env `NO_REPLY_ADDRESS`, default `no-reply@send.getnavigatr.io`. Rules per Decision 6.

- [ ] Tests per email type assert the Reply-To. Expect FAIL. Implement. PASS. Commit.

### Task 21: White-label switch for "Powered by navigatr" in partner emails (FR-PORT-82, Q16)

**Files:** Create `supabase/migrations/20261029000005_portal_brand_powered_by.sql`. Modify `emailTemplate.ts` (`EmailBrand.showPoweredBy`), `portalEmail.ts:76-102`, `apps/app/src/features/settings-hub/tabs/PartnerPortalTab.tsx`. Tests `emailTemplate.test.ts:134-183`, `portalNotify.test.ts:139`, `PartnerPortalTab.test.tsx`.

**Interfaces:** `portal_brand(p_slug)` returns added `show_powered_by boolean` (drop + create + re-grant). `EmailBrand.showPoweredBy: boolean` (default true when missing). Admin toggle uses existing `useUpdateBrand({showPoweredBy})`.

- [ ] Tests: brand with `showPoweredBy=false` omits the line in HTML and text; missing field keeps it; switch visible to admins only, label "Show 'Powered by navigatr' to partners". The app's `AppLayout.tsx` line is untouched. Expect FAIL. Implement. PASS. Commit. Open PR 3.

---

## PR 4: Retention and records

### Task 22: 75-day warning before the 90-day erase (FR-PORT-93, Q19)

**Files:** Create `supabase/migrations/20261030000001_form_submission_purge_warning.sql`. Modify `portalNotify.ts:175-183` (+ summary field), `portalNotifyEmail.ts`. Tests new `070_form_submission_purge_warning.sql`, `portalNotify.test.ts`, `portalNotifyEmail.test.ts`, `046`.

**Interfaces:** Column `referral_form_submissions.purge_warned_at timestamptz` (not granted to authenticated). `enqueue_form_submission_purge_warnings(p_now timestamptz) returns integer` (service_role, advisory lock): untriaged, unpurged, unwarned submissions with `submitted_at <= p_now - (declined_retention_days - 15) days`; one `internal_purge_warning` row per active administrator per org per day (dedupe `internal_purge_warning:<admin>:<local date>`), then sets `purge_warned_at` on the covered rows. Kind list includes Task 18's kind.

- [ ] DB tests (Review Focus 5): an org with 90-day retention warns at day 75, not 74; an org with 30-day retention warns at day 15; a second run the same day queues nothing. Builder subject "{count} referral form submissions will be erased in 15 days". Expect FAIL. Implement. PASS. Commit.

### Task 23: Portal activity log kept 2 years (NFR-PORT-06, Q18)

**Files:** Create `supabase/migrations/20261030000002_purge_portal_audit_log.sql`. Test new `071_purge_portal_audit_log.sql`.

**Interfaces:** `purge_portal_audit_log(p_now timestamptz) returns integer` (service_role, advisory lock) deletes `portal_audit_log` rows with `created_at < p_now - interval '2 years'`; cron `purge-portal-audit-log` daily `25 6 * * *`, idempotent schedule pattern from `20261020000004:70-77`.

- [ ] DB test: 2-year-plus-one-day row deleted, 2-year-minus-one-day row kept. Expect FAIL. Implement. PASS. Commit.

### Task 24: Deferred register entry for Firms

**Files:** Modify `docs/superpowers/specs/2026-10-07-partner-portal-design.md` (deferred register section near line 383).

- [ ] Add: "Firms (FR-PORT-07 to 11). Deferred for beta per Robert 2026-10-27. Trigger: first tenant with a partner firm that has more than one referring person. Each referral stores the partner company as typed, which keeps the history needed for firm totals." Also record FR-PORT-45 moving to the hierarchy-aware duplicates project. Commit. Open PR 4.
