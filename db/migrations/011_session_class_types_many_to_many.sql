-- =====================================================================
-- 011 - a session can have several class types
--
-- class_types stopped being kinds of class (WOD / Open Gym) and became
-- training modalities, and a single session is commonly two of them:
-- "Lower strength + Metcon". A single NOT NULL foreign key cannot say
-- that, so the link moves to a join table.
--
-- Deleting a session takes its tags with it - they describe that session
-- and nothing else. Deleting a class_type stays refused while any
-- session uses it, which is what the existing guard already reports.
--
-- default_capacity and default_duration_min are dropped in the same
-- move: with two modalities on one session neither could win, and both
-- are properties of the class slot rather than of the training style.
-- class_sessions already carries its own capacity, and its duration is
-- starts_at to ends_at.
-- =====================================================================
CREATE TABLE class_session_types (
  class_session_id bigint NOT NULL
    REFERENCES class_sessions (id) ON DELETE CASCADE,
  class_type_id bigint NOT NULL REFERENCES class_types (id),
  PRIMARY KEY (class_session_id, class_type_id)
);

-- Reverse lookup: "which sessions are Metcon".
CREATE INDEX idx_class_session_types_type
  ON class_session_types (class_type_id);

-- Carry any existing single assignment across before the column goes.
INSERT INTO class_session_types (class_session_id, class_type_id)
SELECT
  id,
  class_type_id
FROM
  class_sessions;

ALTER TABLE class_sessions DROP COLUMN class_type_id;

ALTER TABLE class_types
  DROP COLUMN default_capacity,
  DROP COLUMN default_duration_min;
