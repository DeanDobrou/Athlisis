-- =====================================================================
-- 016 - a booking records the membership that paid for it
--
-- The spec described bookings.entitlement_source (subscription | visit)
-- as if it existed. No migration ever created it. What it was standing
-- in for is the fact actually needed: which membership this booking
-- drew on.
--
-- A member can hold several memberships at once - a paused subscription
-- and a visit pack, the August case - so cancelling a booking has to
-- know which pack gets its visit back. The membership answers that, and
-- its plan already says whether it was a subscription or a pack, so a
-- separate category column would only be a second way to say the same
-- thing, free to disagree with the first.
--
-- NOT NULL because every booking is covered by a membership, paid or
-- owed: booking with no coverage creates an unpaid one first (spec 8).
-- Safe to add without a default because no booking has ever been
-- written; the booking service lands alongside this migration.
--
-- This is the first foreign key onto memberships. NO ACTION on purpose,
-- the same reasoning as scores and WODs: a membership delete must never
-- be able to take attendance history with it. Voiding an unpaid
-- membership clears its unattended bookings explicitly, in the action.
--
-- The index serves that delete and listing a membership's bookings:
-- Postgres does not index the referencing side of a foreign key.
-- =====================================================================
ALTER TABLE bookings
  ADD COLUMN membership_id bigint NOT NULL REFERENCES memberships (id);

CREATE INDEX idx_bookings_membership ON bookings (membership_id);
