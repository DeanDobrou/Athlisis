-- =====================================================================
-- 003 - a demo admin
--
-- demo@admin.com, so a fresh database has someone who can log in: admins
-- have no sign-up and no UI (spec section 10). Only the scrypt hash is
-- here, made with `node lib/password.ts`; the password is not in the repo.
--
-- Migrations run on every deploy, so this account exists in production
-- too. Change its password there on the member update form before real
-- data goes in.
--
-- DO NOTHING leaves an account that already has this email alone,
-- password and all. The conflict target is the case-insensitive email
-- index, the same one login matches on.
-- =====================================================================
INSERT INTO users (email, password_hash, first_name, last_name, role)
VALUES (
  'demo@admin.com',
  'scrypt:32768:8:1:2sibJovSHpV1QOukDQJB9Q==:bs2yAWUOflOIgLuq2LsVoxYdJQvjjQQMQjRIcW1a2p2tgSg7uydjMJVuEuwMTBc8wPuoSftISrxDCbLPEQ+gQQ==',
  'Demo',
  'Admin',
  'admin'
)
ON CONFLICT ((lower(email))) DO NOTHING;
