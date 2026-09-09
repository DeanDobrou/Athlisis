-- =====================================================================
-- 012 - one entity: a membership is a period that was paid for
--
-- payments and memberships were strictly 1:1 and modelling them apart
-- let them disagree. Within a day of use the live data already had a
-- payment attached to no period and a period with no payment, which is
-- exactly the state a cash gym cannot afford: "has this member paid?"
-- had no single answer.
--
-- The money moves onto the membership row. No row means no payment and
-- no coverage, by construction, so the question stops existing.
--
-- amount_cents 0 is legitimate: a comp, a trial, or a period granted
-- rather than sold. It is explicit rather than absent.
-- =====================================================================
ALTER TABLE memberships
  ADD COLUMN amount_cents integer NOT NULL DEFAULT 0
    CHECK (amount_cents >= 0),
  ADD COLUMN method payment_method NOT NULL DEFAULT 'cash',
  ADD COLUMN paid_on date,
  ADD COLUMN recorded_by bigint REFERENCES users (id);

-- Fold each payment into the period it bought. The relationship is 1:1,
-- so this cannot pick between competing rows.
UPDATE
  memberships m
SET
  amount_cents = p.amount_cents,
  method = p.method,
  paid_on = p.paid_at::date,
  recorded_by = p.recorded_by
FROM
  payments p
WHERE
  p.membership_id = m.id;

-- A period nobody recorded money against reads as granted, dated from
-- when it started.
UPDATE
  memberships
SET
  paid_on = starts_on
WHERE
  paid_on IS NULL;

ALTER TABLE memberships ALTER COLUMN paid_on SET NOT NULL;

-- Payments not tied to a period bought nothing, so there is nowhere to
-- fold them and they do not survive.
DROP TABLE payments;

-- Only payments.status used it. Cash is taken or it is not.
DROP TYPE payment_status;
