-- =====================================================================
-- 004 - drop users.emergency_contact
--
-- The member form no longer collects it and nothing reads it, so the
-- column is removed rather than left to rot as a permanently NULL field.
-- =====================================================================
ALTER TABLE
  users DROP COLUMN emergency_contact;
