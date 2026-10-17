-- =====================================================================
-- 008 - class type colours
--
-- The owner's palette: warm for strength, cool for conditioning, earthy
-- for skill. Matched on name, so a type that was renamed keeps its colour
-- and staff can still change any of them on the class types screen.
-- =====================================================================
UPDATE class_types t SET color_hex = c.color_hex
FROM (VALUES
  ('Lower strength', '#B94151'),
  ('Upper strength', '#A77113'),
  ('Full body strength', '#8E4AD0'),
  ('Metcon', '#3B85A3'),
  ('Engine', '#4A6ACC'),
  ('Weightlifting', '#BB624C'),
  ('Gymnastics', '#44862D')
) AS c (name, color_hex)
WHERE t.name = c.name;
