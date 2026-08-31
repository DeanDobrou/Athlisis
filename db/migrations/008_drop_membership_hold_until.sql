-- =====================================================================
-- 008 - drop memberships.hold_until
--
-- It existed to say when an on_hold membership resumed. Migration 007
-- removed on_hold, nothing reads the column, and a pause is now a plain
-- inactive status, so it would only ever sit NULL.
-- =====================================================================
ALTER TABLE memberships DROP COLUMN hold_until;
