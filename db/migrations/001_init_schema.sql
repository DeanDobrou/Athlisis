-- =====================================================================
-- CrossFit Gym App — Schema (PostgreSQL 17)
-- File: db/migrations/001_init_schema.sql
--
-- ONE GYM, ONE DATABASE. There is no tenant column anywhere because
-- there is no tenant concept: this database IS the gym.
--
-- Conventions:
--   * Money is stored as integer cents. Never floats.
--   * All timestamps are TIMESTAMPTZ, stored UTC, rendered in the gym's
--     timezone (GYM_TIMEZONE in the environment).
--   * Stripe columns exist but stay NULL in the MVP (manual payments).
--   * Every table carries updated_at + a trigger — the mobile client
--     syncs with `GET /sync?since=`, so a table without it can never
--     reach a device.
--   * Comments sit ABOVE the column they describe, and the trigger
--     function body is single-quoted rather than $$-quoted, so that an
--     editor's SQL formatter cannot mangle this file.
-- =====================================================================
-- ---------------------------------------------------------------------
-- Shared helper: Postgres has no ON UPDATE CURRENT_TIMESTAMP
-- ---------------------------------------------------------------------
CREATE
OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS 'BEGIN NEW.updated_at = now(); RETURN NEW; END;' LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- Enum types
-- ---------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('member', 'coach', 'admin');

CREATE TYPE user_status AS ENUM ('active', 'inactive', 'banned');

CREATE TYPE billing_interval AS ENUM ('monthly', 'yearly', 'one_time');

CREATE TYPE membership_status AS ENUM (
  'active',
  'on_hold',
  'past_due',
  'cancelled',
  'expired'
);

CREATE TYPE session_status AS ENUM ('scheduled', 'cancelled', 'completed');

CREATE TYPE booking_status AS ENUM (
  'booked',
  'waitlisted',
  'checked_in',
  'no_show',
  'cancelled'
);

CREATE TYPE score_type AS ENUM ('time', 'reps', 'load', 'rounds_reps', 'none');

CREATE TYPE payment_method AS ENUM ('stripe', 'cash', 'pos_terminal', 'other');

CREATE TYPE payment_status AS ENUM ('pending', 'succeeded', 'failed', 'refunded');

-- ---------------------------------------------------------------------
-- 1. users — members, coaches, admins
--
--    email/password_hash are NOT NULL: everyone in the database is a
--    member with a real account (spec §1) — there are no guests or
--    drop-in strangers, so there is no unregistered-person case to
--    support.
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(30),
  role user_role NOT NULL DEFAULT 'member',
  avatar_url VARCHAR(500),
  date_of_birth DATE,
  emergency_contact VARCHAR(255),
  -- NULL in MVP
  stripe_customer_id VARCHAR(100),
  status user_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_role ON users(role);

CREATE TRIGGER users_set_updated_at BEFORE
UPDATE
  ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- 2. plans — membership products
--    Recurring: billing_interval monthly/yearly.
--    Visit pack: billing_interval 'one_time' + class_credits.
-- ---------------------------------------------------------------------
CREATE TABLE plans (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  billing_interval billing_interval NOT NULL DEFAULT 'monthly',
  -- NULL = unlimited classes
  class_credits INTEGER CHECK (
    class_credits IS NULL
    OR class_credits > 0
  ),
  -- NULL in MVP
  stripe_price_id VARCHAR(100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER plans_set_updated_at BEFORE
UPDATE
  ON plans FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- 3. memberships — a user subscribed to a plan.
--    Optional: a member covering bookings only via the monthly unpaid
--    allowance (spec §8) never needs a row here.
-- ---------------------------------------------------------------------
CREATE TABLE memberships (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  plan_id BIGINT NOT NULL REFERENCES plans(id),
  status membership_status NOT NULL DEFAULT 'active',
  starts_on DATE NOT NULL,
  -- NULL = open-ended
  ends_on DATE,
  -- injury / vacation holds
  hold_until DATE,
  -- for credit-based plans
  credits_remaining INTEGER CHECK (
    credits_remaining IS NULL
    OR credits_remaining >= 0
  ),
  -- NULL in MVP
  stripe_subscription_id VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    ends_on IS NULL
    OR ends_on >= starts_on
  )
);

CREATE INDEX idx_memberships_user_status ON memberships(user_id, status);

CREATE TRIGGER memberships_set_updated_at BEFORE
UPDATE
  ON memberships FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- 4. class_types — WOD, Open Gym, Foundations...
--    Mirrored to the mobile client, so it needs updated_at like the rest.
-- ---------------------------------------------------------------------
CREATE TABLE class_types (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  -- calendar UI, e.g. '#E5484D'
  color_hex CHAR(7),
  default_capacity INTEGER NOT NULL DEFAULT 14 CHECK (default_capacity > 0),
  default_duration_min INTEGER NOT NULL DEFAULT 60 CHECK (default_duration_min > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER class_types_set_updated_at BEFORE
UPDATE
  ON class_types FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- 5. class_sessions — a concrete class occurrence on the calendar
-- ---------------------------------------------------------------------
CREATE TABLE class_sessions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  class_type_id BIGINT NOT NULL REFERENCES class_types(id),
  coach_id BIGINT REFERENCES users(id),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  status session_status NOT NULL DEFAULT 'scheduled',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX idx_sessions_starts_at ON class_sessions(starts_at);

CREATE INDEX idx_sessions_type_start ON class_sessions(class_type_id, starts_at);

CREATE TRIGGER class_sessions_set_updated_at BEFORE
UPDATE
  ON class_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- 6. bookings — user <-> session, full status lifecycle.
--    Powers attendance, waitlists, no-show tracking, churn alerts.
--    Online-only action (needs a real-time capacity check).
--
--    UNIQUE (user_id, class_session_id) means a member who cancels and
--    rebooks the same class UPDATEs their row — the booking service must
--    be upsert-shaped, there is never a second row.
--
--    Capacity is NOT enforced here: it is a count across rows, so the
--    booking transaction must SELECT ... FOR UPDATE the session row or
--    concurrent bookings will oversell the class.
-- ---------------------------------------------------------------------
CREATE TABLE bookings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  class_session_id BIGINT NOT NULL REFERENCES class_sessions(id),
  status booking_status NOT NULL DEFAULT 'booked',
  booked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_in_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, class_session_id)
);

CREATE INDEX idx_bookings_session_status ON bookings(class_session_id, status);

CREATE INDEX idx_bookings_user_status ON bookings(user_id, status);

-- Waitlist position is derived at query time, not stored:
--   ROW_NUMBER() OVER (PARTITION BY class_session_id ORDER BY booked_at)
-- over rows WHERE status = 'waitlisted'. A stored column plus a partial
-- unique index breaks on promotion (renumbering trips the index
-- mid-statement) and can drift; derived cannot.

CREATE TRIGGER bookings_set_updated_at BEFORE
UPDATE
  ON bookings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- 7. wods — the programmed workout for a date.
--    published_at NULL = draft, visible to coaches only.
-- ---------------------------------------------------------------------
CREATE TABLE wods (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wod_date DATE NOT NULL,
  -- NULL = gym-wide WOD
  class_type_id BIGINT REFERENCES class_types(id),
  title VARCHAR(150),
  -- markdown ok
  description TEXT NOT NULL,
  score_type score_type NOT NULL DEFAULT 'time',
  time_cap_seconds INTEGER CHECK (
    time_cap_seconds IS NULL
    OR time_cap_seconds > 0
  ),
  published_at TIMESTAMPTZ,
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wods_date ON wods(wod_date);

-- One WOD per date per class type; NULLS NOT DISTINCT makes the
-- gym-wide (NULL class_type_id) case unique too.
CREATE UNIQUE INDEX uq_wods_date_type ON wods(wod_date, class_type_id) NULLS NOT DISTINCT;

CREATE TRIGGER wods_set_updated_at BEFORE
UPDATE
  ON wods FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- 8. wod_scores — a member's logged result; feeds the leaderboard.
--    Leaderboard sorts by the column matching wods.score_type:
--      time        -> time_seconds ASC
--      reps        -> reps DESC
--      load        -> load_kg DESC
--      rounds_reps -> rounds DESC, reps DESC
--    client_uuid is set by the mobile app for offline-created rows so
--    sync retries upsert instead of duplicating.
--
--    NO ON DELETE CASCADE from wods: deleting a programmed WOD would
--    silently destroy logged member results, and delta-sync has no way
--    to tell a device that a row disappeared. A scored WOD cannot be
--    deleted — unpublish it instead.
-- ---------------------------------------------------------------------
CREATE TABLE wod_scores (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- NULL for rows created on the web
  client_uuid UUID UNIQUE,
  wod_id BIGINT NOT NULL REFERENCES wods(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  time_seconds INTEGER CHECK (
    time_seconds IS NULL
    OR time_seconds > 0
  ),
  rounds INTEGER CHECK (
    rounds IS NULL
    OR rounds >= 0
  ),
  reps INTEGER CHECK (
    reps IS NULL
    OR reps >= 0
  ),
  load_kg NUMERIC(6, 2) CHECK (
    load_kg IS NULL
    OR load_kg >= 0
  ),
  is_rx BOOLEAN NOT NULL DEFAULT FALSE,
  -- capped scores sort last
  finished_within_cap BOOLEAN NOT NULL DEFAULT TRUE,
  notes VARCHAR(500),
  logged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (wod_id, user_id),
  -- A score row with no score is meaningless; attendance is tracked by
  -- bookings.checked_in, not here. score_type 'none' WODs get no rows.
  CONSTRAINT score_not_empty CHECK (num_nonnulls(time_seconds, rounds, reps, load_kg) > 0)
);

CREATE INDEX idx_scores_user ON wod_scores(user_id);

CREATE TRIGGER wod_scores_set_updated_at BEFORE
UPDATE
  ON wod_scores FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- 9. payments — charge log. MVP: recorded manually (cash / terminal).
--    membership_id NULL = a payment not tied to a membership row
--    (e.g. settling up an unpaid booking).
--    updated_at because refunds mutate the row after it is written.
-- ---------------------------------------------------------------------
CREATE TABLE payments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  membership_id BIGINT REFERENCES memberships(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  method payment_method NOT NULL DEFAULT 'cash',
  status payment_status NOT NULL DEFAULT 'succeeded',
  -- NULL in MVP
  stripe_payment_intent_id VARCHAR(100) UNIQUE,
  -- NULL in MVP
  stripe_invoice_id VARCHAR(100),
  -- 'Visit pack 2026-07-28'
  description VARCHAR(255),
  -- which admin entered it
  recorded_by BIGINT REFERENCES users(id),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_user ON payments(user_id);

CREATE INDEX idx_payments_paid_at ON payments(paid_at);

CREATE TRIGGER payments_set_updated_at BEFORE
UPDATE
  ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- Seed: default class types
-- ---------------------------------------------------------------------
INSERT INTO
  class_types (name, color_hex, default_capacity, default_duration_min)
VALUES
  ('WOD', '#E5484D', 14, 60),
  ('Open Gym', '#30A46C', 20, 90),
  ('Foundations', '#0090FF', 8, 60);
