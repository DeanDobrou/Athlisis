-- =====================================================================
-- 005 - drop plans.description and plans.is_active
--
-- The plan form collects neither. A plan is now name, price, billing
-- interval and class credits; nothing else reads these two columns.
--
-- Consequence: a plan that has been sold can no longer be retired, only
-- left in place, because deleting it is refused by the memberships
-- foreign key. Reintroduce is_active if hiding old plans becomes a need.
-- =====================================================================
ALTER TABLE plans
  DROP COLUMN description,
  DROP COLUMN is_active;
