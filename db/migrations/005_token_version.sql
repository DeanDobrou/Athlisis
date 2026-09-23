-- =====================================================================
-- 005 - token_version, the per-user session kill switch
--
-- Tokens carry no expiry, so the only way to end a session was to
-- deactivate the account - and reactivating it brought every old token
-- back to life. A member who quits in March and rejoins in September
-- would arrive with March's token still working.
--
-- The token now carries this number as a claim and both gates compare
-- it to the column, so raising it refuses every token minted before.
-- It is raised when a password changes and when an account is
-- deactivated.
--
-- Active users start at 0, which is what a token minted before this
-- migration reads as, so nobody signed in right now is logged out.
-- Users already inactive start at 1, which kills the tokens they left
-- behind without touching anyone still using the app.
-- =====================================================================
ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;

UPDATE users SET token_version = 1 WHERE status = 'inactive';
