-- =====================================================================
-- 004 - the monthly plan becomes unlimited
--
-- The owner dropped the 12-visit limit from the 60 euro monthly plan.
-- The only limit left is one class a day, which the booking service
-- already enforces. A blank plans.visits already means unlimited, but
-- every membership copied the count when it was sold, so the periods
-- still running are cleared too, or their members stay capped until
-- they renew. Past periods keep their counts as history.
--
-- Matched on interval and price rather than name, since the name is the
-- owner's to change. On a fresh database both updates touch nothing.
-- =====================================================================
UPDATE plans SET visits = NULL
WHERE billing_interval = 'monthly' AND price_cents = 6000;

UPDATE memberships m SET visits_remaining = NULL
FROM plans p
WHERE p.id = m.plan_id
  AND p.billing_interval = 'monthly' AND p.price_cents = 6000
  AND (m.ends_on IS NULL OR m.ends_on >= current_date);
