-- =====================================================================
-- 002 - a booking's membership belongs to the booking's member
--
-- 001 records which membership paid for a booking, but nothing said it
-- had to be the member's own. The update form can move a membership to
-- another member, and the bookings made on it stayed pointing at it: a
-- cancellation then returned the visit to someone else's pack.
--
-- A composite foreign key says it once for every writer, the form, the
-- booking service and psql alike. Moving a membership that has bookings
-- now fails with 23503, which the update action reports; one with none
-- can still move, which is how picking the wrong member gets fixed.
--
-- It replaces 001's single-column key rather than sitting beside it:
-- both columns are NOT NULL, so the pair implies the single, and two
-- constraints saying the same thing are only free to disagree.
--
-- The unique pair is trivially true, since id alone is the primary key,
-- but a foreign key can only point at columns declared unique together.
--
-- It also guards the squash. A database that never reached the end of
-- the old migrations has no bookings_membership_id_fkey to drop, so this
-- fails there and the deploy stops instead of running on a wrong schema.
-- =====================================================================
ALTER TABLE memberships
  ADD CONSTRAINT memberships_id_user_id_key UNIQUE (id, user_id);

ALTER TABLE bookings
  DROP CONSTRAINT bookings_membership_id_fkey,
  ADD CONSTRAINT bookings_membership_belongs_to_member
    FOREIGN KEY (membership_id, user_id)
    REFERENCES memberships (id, user_id);
