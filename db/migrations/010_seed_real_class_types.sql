-- =====================================================================
-- 010 - replace the placeholder class types with the real ones
--
-- 001 seeded WOD / Open Gym / Foundations as stand-ins. The gym works in
-- training modalities instead, so those are the rows that belong here.
--
-- The old three are only removed when nothing references them, so this
-- stays safe to run against a database that already has a schedule.
-- =====================================================================
INSERT INTO class_types (name, color_hex, default_capacity, default_duration_min)
VALUES
  ('Lower strength',      '#E5484D', 14, 60),
  ('Upper strength',      '#F76B15', 14, 60),
  ('Full body strength',  '#FFB224', 14, 60),
  ('Weightlifting',       '#E93D82', 14, 60),
  ('Metcon',              '#30A46C', 14, 60),
  ('Engine',              '#0090FF', 14, 60),
  ('Gymnastics',          '#8E4EC6', 14, 60);

DELETE FROM class_types c
WHERE
  c.name IN ('WOD', 'Open Gym', 'Foundations')
  AND NOT EXISTS (
    SELECT 1 FROM class_sessions s WHERE s.class_type_id = c.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM wods w WHERE w.class_type_id = c.id
  );
