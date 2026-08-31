-- =====================================================================
-- 006 - rename credits to visits
--
-- The dashboard calls these visits, so the schema does too. Renaming now
-- rather than after the booking service starts reading the column.
--
-- NULL still means unlimited on plans.visits.
-- =====================================================================
ALTER TABLE plans RENAME COLUMN class_credits TO visits;
ALTER TABLE memberships RENAME COLUMN credits_remaining TO visits_remaining;

ALTER TABLE plans
  RENAME CONSTRAINT plans_class_credits_check TO plans_visits_check;
ALTER TABLE memberships
  RENAME CONSTRAINT memberships_credits_remaining_check
  TO memberships_visits_remaining_check;
