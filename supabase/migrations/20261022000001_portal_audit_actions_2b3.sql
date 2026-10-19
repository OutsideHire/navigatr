-- 20261022000001_portal_audit_actions_2b3.sql
--
-- Partner Portal Phase 2B-3. New audit actions, alone in this file: a value
-- added with ALTER TYPE ... ADD VALUE cannot be used in the transaction that
-- adds it, and 20261022000003 and 20261022000004 use all three.
--   note         a partner posted a note on a referral sent to them (FR-PORT-78, rate limited)
--   export       a partner downloaded their referrals as CSV (NFR-PORT-06)
--   unsubscribe  a weekly summary unsubscribe request (FR-PORT-84, rate limited per IP)

alter type portal_audit_action add value if not exists 'note';
alter type portal_audit_action add value if not exists 'export';
alter type portal_audit_action add value if not exists 'unsubscribe';
