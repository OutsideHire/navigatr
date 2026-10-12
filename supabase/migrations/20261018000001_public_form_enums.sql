-- 20261018000001_public_form_enums.sql
--
-- Partner Portal Phase 2B-1 (public referral form). New enum values, alone in
-- this file: a value added with ALTER TYPE ... ADD VALUE cannot be used in the
-- transaction that adds it, and 20261018000002 and 20261018000003 use them.
--   referral_source portal_public       a referral made from a public form
--                                        submission at triage (Phase 2B-2)
--   portal_audit_action public_submit   a public form submission was stored
--   portal_audit_action link_regenerate an internal user retired a form link

alter type referral_source add value if not exists 'portal_public';
alter type portal_audit_action add value if not exists 'public_submit';
alter type portal_audit_action add value if not exists 'link_regenerate';
