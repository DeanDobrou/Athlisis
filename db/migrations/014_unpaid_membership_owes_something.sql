-- =====================================================================
-- 014 - an unpaid period must owe something
--
-- amount_cents 0 with paid_on NULL reads as "owes nothing, and has not
-- paid it", which is not a state anything should be able to write.
-- Zero stays legitimate once the money question is settled: a comp, a
-- trial, or a period granted rather than sold (see 012).
--
-- Consequence for the booking service: a zero-priced plan is created
-- paid, with paid_on set, because there is nothing to collect. The gym
-- already sells one - 'Friends of the gym', 0 cents - so this is not a
-- hypothetical branch.
-- =====================================================================
ALTER TABLE memberships
  ADD CONSTRAINT memberships_unpaid_owes_something
    CHECK (paid_on IS NOT NULL OR amount_cents > 0);
