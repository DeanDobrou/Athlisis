-- =====================================================================
-- 003 — case-insensitive email uniqueness
--
-- Login matches WHERE lower(email) = $1, but the column's UNIQUE
-- constraint is case-sensitive, so Bob@gym.com and bob@gym.com could
-- coexist — and the login query would only ever find one of them.
-- Enforce uniqueness at the granularity the login code already assumes,
-- and drop the old constraint the new index makes redundant.
--
-- If case-variant duplicates already exist, CREATE UNIQUE INDEX fails
-- and the transaction rolls back: resolve the duplicates by hand first.
-- =====================================================================
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));

ALTER TABLE
  users DROP CONSTRAINT users_email_key;
