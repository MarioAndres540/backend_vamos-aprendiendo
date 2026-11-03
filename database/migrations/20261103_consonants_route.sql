-- Ruta "Consonantes": ejercicios de la tarjeta Consonantes de Unity (22 letras, mayúscula y minúscula = 44 ejercicios).
--
-- Antes estaban en el catálogo como INACTIVOS de la ruta 'escritura', por eso no contaban en el dashboard aunque el niño ya
-- tuviera consonantes hechas (Unity las enviaba y el backend las registraba, pero route-progress ignoraba las inactivas).
-- Ahora son una ruta propia, que es como las muestra Unity (Tu ruta: Números, Letras minúsculas/mayúsculas, Consonantes).
--
-- Los ids NO cambian ('escritura.up_B', 'escritura.lo_b'...): Unity y el progreso ya guardado los siguen usando igual.
-- Es idempotente. Aplicar en el SQL Editor de Supabase.

INSERT INTO public.learning_routes (id, name, sort_order)
VALUES ('consonantes', 'Consonantes', 3)
ON CONFLICT (id) DO NOTHING;

-- Las consonantes son todo lo que Unity trae de letras fuera de las vocales (A, E, I, O, U)
UPDATE public.exercise_catalog
SET route_id = 'consonantes', is_active = TRUE
WHERE route_id = 'escritura'
  AND element_type = 'letra'
  AND upper(substring(glyph_id FROM 4)) NOT IN ('A', 'E', 'I', 'O', 'U');

-- Resultado esperado: matematicas 10, escritura 10 (vocales), consonantes 44
-- SELECT route_id, count(*) FILTER (WHERE is_active) AS activos FROM public.exercise_catalog GROUP BY route_id ORDER BY 1;
