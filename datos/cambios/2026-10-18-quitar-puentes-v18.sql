-- =====================================================================
-- CAMBIO 18 oct 2026 · Quitar los puentes de la v18
-- ---------------------------------------------------------------------
-- Tras el paso 2 (2026-10-18-paso-2-comun-multibar.sql), los nombres viejos
-- de la v18 (carta_menu, panel_estado…) se dejaron como puentes de una línea
-- hacia los nuevos (…_multibar). La web v19 ya solo usa los nuevos y nadie
-- usa la v18 (Carlos, 18 oct; registros de Supabase sin llamadas), así que
-- se quitan.
-- Solo borra funciones que cumplen TODO esto: están en public, su comentario
-- empieza por «puente_v18 → public.», son SQL de una línea (security invoker)
-- y la función nueva a la que llaman existe. Si no salen exactamente 27, no
-- quita ninguna y da error.
-- Lleva DROP: lo pega Carlos en Supabase → SQL Editor → Run.
-- =====================================================================
begin;

do $$
declare f record; n int := 0;
begin
  select count(*) into n
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public'
     and obj_description(p.oid, 'pg_proc') like 'puente\_v18 → public.%'
     and p.prolang = (select oid from pg_language where lanname = 'sql')
     and not p.prosecdef
     and to_regproc('public.' || p.proname || '_multibar') is not null;
  if n <> 27 then
    raise exception 'Se esperaban 27 puentes y hay %: no se quita nada', n;
  end if;

  for f in
    select p.oid::regprocedure as firma
      from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public'
       and obj_description(p.oid, 'pg_proc') like 'puente\_v18 → public.%'
       and p.prolang = (select oid from pg_language where lanname = 'sql')
       and not p.prosecdef
       and to_regproc('public.' || p.proname || '_multibar') is not null
  loop
    execute format('drop function %s', f.firma);
  end loop;
end $$;

-- Comprobación: ya no queda ningún puente y las 27 funciones nuevas siguen.
do $$
begin
  if exists (select 1 from pg_proc where obj_description(oid, 'pg_proc') like 'puente\_v18%') then
    raise exception 'Aún quedan puentes';
  end if;
  if (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname = 'public' and p.proname like '%\_multibar') <> 27 then
    raise exception 'Faltan funciones _multibar';
  end if;
end $$;

commit;
