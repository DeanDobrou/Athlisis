-- =====================================================================
-- 002 - drop the unused 'banned' user status
--
-- active/inactive covers everything the gym needs: a member either has
-- access or does not. Postgres has no ALTER TYPE ... DROP VALUE, so the
-- enum is rebuilt and the column re-pointed at the new type.
-- =====================================================================
-- Any existing banned rows become inactive, so this is safe to run
-- whenever, not only against an empty table.
UPDATE
  users
SET
  status = 'inactive'
WHERE
  status = 'banned';

ALTER TABLE
  users
ALTER COLUMN
  status DROP DEFAULT;

ALTER TYPE user_status RENAME TO user_status_old;

CREATE TYPE user_status AS ENUM ('active', 'inactive');

ALTER TABLE
  users
ALTER COLUMN
  status TYPE user_status USING status::text::user_status;

ALTER TABLE
  users
ALTER COLUMN
  status
SET
  DEFAULT 'active';

DROP TYPE user_status_old;
