-- 20261016000001_portal_audit_actions_2a.sql
--
-- Partner Portal Phase 2A. New audit actions, alone in this file: a value added
-- with ALTER TYPE ... ADD VALUE cannot be used in the transaction that adds it,
-- and 20261016000002 and 20261016000007 use both.
--   purge           personal details erased (90-day referral purge, FR-PORT-91..95)
--                   or a portal identity erased on offboarding (NFR-PORT-09)
--   profile_update  a partner saved their profile (FR-PORT-19, rate limited)

alter type portal_audit_action add value if not exists 'purge';
alter type portal_audit_action add value if not exists 'profile_update';
