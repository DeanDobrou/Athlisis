-- =====================================================================
-- 007 - reduce membership_status to active/inactive
--
-- Coverage is decided by status + starts_on + ends_on, so a membership
-- either counts or it does not. on_hold, past_due and expired were all
-- read as "not active" by that rule, which made them labels rather than
-- behaviour: past_due now falls out of ends_on being in the past.
--
-- Postgres has no ALTER TYPE ... DROP VALUE, so the enum is rebuilt and
-- the column re-pointed. Adding statuses back for Stripe subscriptions
-- later is a plain ALTER TYPE ... ADD VALUE, which spec section 6 rule 3
-- already permits.
-- =====================================================================
-- Anything that was not active becomes inactive, so this is safe to run
-- against a populated table, not only an empty one.
UPDATE
  memberships
SET
  status = 'cancelled'
WHERE
  status <> 'active';

ALTER TABLE
  memberships
ALTER COLUMN
  status DROP DEFAULT;

ALTER TYPE membership_status RENAME TO membership_status_old;

CREATE TYPE membership_status AS ENUM ('active', 'inactive');

ALTER TABLE
  memberships
ALTER COLUMN
  status TYPE membership_status USING (
    CASE status::text
      WHEN 'active' THEN 'active'
      ELSE 'inactive'
    END
  )::membership_status;

ALTER TABLE
  memberships
ALTER COLUMN
  status
SET
  DEFAULT 'active';

DROP TYPE membership_status_old;
