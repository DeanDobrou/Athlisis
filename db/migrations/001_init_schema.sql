-- =====================================================================
-- 001 - the schema (PostgreSQL 17)
--
-- Squashed on 2026-09-14 from the sixteen migrations that built it. The
-- old files, and why each change was made, are in git history. A
-- database that already ran them has this file in its ledger under the
-- same name, so it skips it and applies only 002 onwards (spec section 4).
--
-- ONE GYM, ONE DATABASE. No tenant column anywhere: this database IS the
-- gym.
--
-- Conventions:
--   * Money is integer cents. Never floats.
--   * Timestamps are TIMESTAMPTZ, and the database runs on the gym's
--     timezone, set below.
--   * Every table the mobile client syncs carries updated_at + a trigger:
--     it pulls with GET /sync?since=, so a table without one can never
--     reach a device.
--   * Comments sit ABOVE what they describe, and function bodies are
--     single-quoted rather than dollar-quoted, so an editor's SQL
--     formatter cannot mangle this file.
-- =====================================================================
-- Member search folds accents on both sides of ILIKE; see greekFold()
-- in lib/db.ts.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Athens, not the container's UTC: at 01:00 local, current_date in UTC is
-- still yesterday, and memberships would read the wrong state for three
-- hours a night. Set on the database so it survives a container rebuild
-- and applies to psql and the app alike. The name differs by environment,
-- which ALTER DATABASE will not take as an expression, hence the DO block.
DO 'BEGIN EXECUTE format(''ALTER DATABASE %I SET timezone = %L'', current_database(), ''Europe/Athens''); END';

-- Postgres has no ON UPDATE CURRENT_TIMESTAMP.
CREATE FUNCTION set_updated_at() RETURNS TRIGGER AS 'BEGIN NEW.updated_at = now(); RETURN NEW; END;' LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- Enum types. Removing a value later means rebuilding the type: rename
-- it, create the new one, re-point the column, drop the old.
-- ---------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('member', 'admin');

CREATE TYPE user_status AS ENUM ('active', 'inactive');

CREATE TYPE billing_interval AS ENUM ('monthly', 'yearly', 'one_time');

CREATE TYPE membership_status AS ENUM ('active', 'inactive');

CREATE TYPE session_status AS ENUM ('scheduled', 'cancelled', 'completed');

CREATE TYPE booking_status AS ENUM (
  'booked',
  'waitlisted',
  'checked_in',
  'no_show',
  'cancelled'
);

CREATE TYPE payment_method AS ENUM ('cash', 'pos_terminal', 'other');

-- ---------------------------------------------------------------------
-- users - members and admins. Everyone has a real account, created by
-- staff, so email and password_hash are NOT NULL.
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(30),
  role user_role NOT NULL DEFAULT 'member',
  avatar_url VARCHAR(500),
  date_of_birth DATE,
  status user_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Login matches lower(email), so uniqueness is case-insensitive too.
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));

CREATE INDEX idx_users_role ON users (role);

CREATE TRIGGER users_set_updated_at BEFORE
UPDATE
  ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- plans - membership products
-- ---------------------------------------------------------------------
CREATE TABLE plans (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  billing_interval billing_interval NOT NULL DEFAULT 'monthly',
  -- NULL = unlimited. one_time with visits is a visit pack.
  visits INTEGER CHECK (
    visits IS NULL
    OR visits > 0
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER plans_set_updated_at BEFORE
UPDATE
  ON plans FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- memberships - a member on a plan for a period, and the money for it.
-- Several per member. Coverage is status + starts_on + ends_on; the
-- state staff read is derived from those plus paid_on, never stored.
-- ---------------------------------------------------------------------
CREATE TABLE memberships (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users (id),
  plan_id BIGINT NOT NULL REFERENCES plans (id),
  status membership_status NOT NULL DEFAULT 'active',
  starts_on DATE NOT NULL,
  -- NULL = open-ended
  ends_on DATE,
  -- copied from plans.visits when sold; NULL = unlimited
  visits_remaining INTEGER CHECK (
    visits_remaining IS NULL
    OR visits_remaining >= 0
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- what the period costs; 0 = granted rather than sold
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  method payment_method NOT NULL DEFAULT 'cash',
  -- when the money was collected; NULL = owed, a booking on a promise
  paid_on DATE,
  -- the admin who took the money
  recorded_by BIGINT REFERENCES users (id),
  CHECK (
    ends_on IS NULL
    OR ends_on >= starts_on
  ),
  -- a row owing zero that nobody has paid is not a state worth writing
  CONSTRAINT memberships_unpaid_owes_something CHECK (
    paid_on IS NOT NULL
    OR amount_cents > 0
  )
);

CREATE INDEX idx_memberships_user_status ON memberships (user_id, status);

CREATE TRIGGER memberships_set_updated_at BEFORE
UPDATE
  ON memberships FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- class_types - training modalities. Mirrored to the mobile client.
-- ---------------------------------------------------------------------
CREATE TABLE class_types (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  color_hex CHAR(7),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER class_types_set_updated_at BEFORE
UPDATE
  ON class_types FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- class_sessions - a concrete class on the calendar
-- ---------------------------------------------------------------------
CREATE TABLE class_sessions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  coach_id BIGINT REFERENCES users (id),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  status session_status NOT NULL DEFAULT 'scheduled',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX idx_sessions_starts_at ON class_sessions (starts_at);

CREATE TRIGGER class_sessions_set_updated_at BEFORE
UPDATE
  ON class_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- class_session_types - one class is often two modalities, "Lower
-- strength + Metcon". Deleting a class takes its tags with it; deleting
-- a type stays refused while a class uses it.
-- ---------------------------------------------------------------------
CREATE TABLE class_session_types (
  class_session_id BIGINT NOT NULL REFERENCES class_sessions (id) ON DELETE CASCADE,
  class_type_id BIGINT NOT NULL REFERENCES class_types (id),
  PRIMARY KEY (class_session_id, class_type_id)
);

CREATE INDEX idx_class_session_types_type ON class_session_types (class_type_id);

-- ---------------------------------------------------------------------
-- bookings - member <-> class, with a status lifecycle.
--
-- Unique (user_id, class_session_id): cancel then rebook UPDATEs the row,
-- so the booking service is upsert-shaped. Capacity is a count across
-- rows, not a constraint, so booking locks the class row first.
-- Waitlist position is derived with ROW_NUMBER(), never stored.
-- ---------------------------------------------------------------------
CREATE TABLE bookings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users (id),
  class_session_id BIGINT NOT NULL REFERENCES class_sessions (id),
  status booking_status NOT NULL DEFAULT 'booked',
  booked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_in_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- the membership that paid, so a cancellation returns the visit to it.
  -- NO ACTION: deleting a membership must never take attendance with it.
  membership_id BIGINT NOT NULL REFERENCES memberships (id),
  UNIQUE (user_id, class_session_id)
);

CREATE INDEX idx_bookings_session_status ON bookings (class_session_id, status);

CREATE INDEX idx_bookings_user_status ON bookings (user_id, status);

-- Postgres does not index the referencing side of a foreign key.
CREATE INDEX idx_bookings_membership ON bookings (membership_id);

CREATE TRIGGER bookings_set_updated_at BEFORE
UPDATE
  ON bookings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- wods - the programmed workout for a date
-- ---------------------------------------------------------------------
CREATE TABLE wods (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wod_date DATE NOT NULL,
  -- NULL = gym-wide WOD
  class_type_id BIGINT REFERENCES class_types (id),
  title VARCHAR(150),
  -- markdown ok
  description TEXT NOT NULL,
  time_cap_seconds INTEGER CHECK (
    time_cap_seconds IS NULL
    OR time_cap_seconds > 0
  ),
  -- NULL = draft, visible to admins only
  published_at TIMESTAMPTZ,
  created_by BIGINT NOT NULL REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wods_date ON wods (wod_date);

-- One WOD per date per class type; NULLS NOT DISTINCT makes the gym-wide
-- (NULL class_type_id) case unique too.
CREATE UNIQUE INDEX uq_wods_date_type ON wods (wod_date, class_type_id) NULLS NOT DISTINCT;

CREATE TRIGGER wods_set_updated_at BEFORE
UPDATE
  ON wods FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- Seed: the gym's training modalities
-- ---------------------------------------------------------------------
INSERT INTO
  class_types (name, color_hex)
VALUES
  ('Lower strength', '#E5484D'),
  ('Upper strength', '#F76B15'),
  ('Full body strength', '#FFB224'),
  ('Weightlifting', '#E93D82'),
  ('Metcon', '#30A46C'),
  ('Engine', '#0090FF'),
  ('Gymnastics', '#8E4EC6');
