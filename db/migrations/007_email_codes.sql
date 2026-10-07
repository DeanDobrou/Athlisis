-- =====================================================================
-- 007 - email_codes
--
-- One-time codes sent by email: to set a new password after forgetting
-- the old one, and to confirm a new email address before it replaces the
-- current one. An account holds at most one live code per purpose, and
-- asking again replaces it. Only a hash of the code is stored.
--
-- The codes go with the account, so they never block deleting a member.
-- =====================================================================
CREATE TABLE email_codes (
  user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('password_reset', 'email_change')),
  -- where the code was sent: the account's address, or the new one
  email VARCHAR(255) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, purpose)
);
