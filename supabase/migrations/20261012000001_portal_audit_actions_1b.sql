-- 20261012000001_portal_audit_actions_1b.sql
--
-- Partner Portal Phase 1B. New audit actions, alone in this file: a value added
-- with ALTER TYPE ... ADD VALUE cannot be used in the transaction that adds it,
-- and 20261012000002..000004 use all three.
--   sign_in_failed  every failed code verification (1A tracker item)
--   dup_check       the soft duplicate check (rate limited per portal user)
--   transcribe      portal speech-to-text (rate limited per portal user)

alter type portal_audit_action add value if not exists 'sign_in_failed';
alter type portal_audit_action add value if not exists 'dup_check';
alter type portal_audit_action add value if not exists 'transcribe';
