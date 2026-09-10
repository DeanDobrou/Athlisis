-- =====================================================================
-- 009 - run the database on Greek time
--
-- The container defaults to UTC, and Athens is UTC+3 in summer. Between
-- midnight and 03:00 local, current_date was still yesterday, so for
-- three hours every night a membership that had ended still read Active
-- and one starting that morning still read Scheduled.
--
-- One gym, one timezone (spec section 3), so the database is pinned to
-- it rather than every query converting. This also makes to_char() on
-- created_at render the local date.
--
-- Set on the database, not the container, so it survives a rebuild and
-- applies to psql and the app alike. New connections pick it up: restart
-- the app after applying.
-- =====================================================================
-- The name comes from current_database() because it differs by environment:
-- crossfit_gym locally, postgres on Coolify. ALTER DATABASE won't take an
-- expression for the name, hence the DO block.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone = %L', current_database(), 'Europe/Athens');
END
$$;
