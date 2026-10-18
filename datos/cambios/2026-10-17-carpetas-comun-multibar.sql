-- =====================================================================
-- CAMBIO 17 oct 2026 · Carpetas (esquemas) comun, multibar y autonomialab
-- ---------------------------------------------------------------------
-- Fase 1, paso 1 de la arquitectura (ver CLAUDE.md): las tablas pasan de
-- «public» a su carpeta, sin cambiar nada de lo que ve la web.
--   comun    ← bares, staff
--   multibar ← categories, products, mesas, orders, order_items, avisos
--   autonomialab: vacía (gestión de la empresa, más adelante)
-- Las funciones que llama la web se quedan en «public» con los mismos
-- nombres y respuestas: solo se les añade la ruta de las carpetas nuevas.
-- Las sesiones y los enlaces de recuperación siguen en «privado» hasta el
-- paso 2 (el login nuevo de comun).
-- «alter table … set schema» conserva datos, números, relaciones,
-- índices y el trigger. No borra nada.
-- =====================================================================

begin;

create schema if not exists comun;
create schema if not exists multibar;
create schema if not exists autonomialab;
revoke all on schema comun, multibar, autonomialab from public, anon, authenticated;

alter table public.bares       set schema comun;
alter table public.staff       set schema comun;
alter table public.categories  set schema multibar;
alter table public.products    set schema multibar;
alter table public.mesas       set schema multibar;
alter table public.orders      set schema multibar;
alter table public.order_items set schema multibar;
alter table public.avisos      set schema multibar;

-- Todas las funciones de la web y los ayudantes buscan también en las carpetas nuevas.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'privado')
       and 'search_path=public, privado, pg_temp' = any (p.proconfig)
  loop
    execute format('alter function %s set search_path = public, comun, multibar, privado, pg_temp', f.firma);
  end loop;
end $$;

-- Los tres ayudantes que nombraban «public.bares» / «public.staff» por escrito
-- (copia exacta de datos/funciones.sql).
-- El bar de un slug (o error si no existe o no está activo).
create or replace function privado.bar_de_slug(p_bar text)
returns comun.bares
language plpgsql stable security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare b comun.bares;
begin
  select * into b from bares where slug = lower(btrim(coalesce(p_bar, ''))) and activo;
  if not found then
    raise exception 'BAR_NO_VALIDO';
  end if;
  return b;
end $$;

-- Lo que la web necesita saber del bar (nombre, subtítulo y ajustes).
create or replace function privado.bar_json(p_bar_id integer)
returns jsonb
language sql stable security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
  select jsonb_build_object('slug', slug, 'nombre', nombre, 'subtitulo', subtitulo, 'ajustes', ajustes)
    from bares where id = p_bar_id
$$;

-- Quién es el usuario del personal de este token (o error si no vale).
-- Si su bar está desactivado, la sesión deja de valer.
create or replace function privado.staff_de_token(p_token text)
returns comun.staff
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s comun.staff;
begin
  if p_token is null or length(p_token) <> 64 then
    raise exception 'SESION_CADUCADA';
  end if;
  select st.* into s
    from privado.sesiones se
    join comun.staff st on st.id = se.staff_id
    join comun.bares b on b.id = st.bar_id
   where se.token_hash = privado.digest(p_token, 'sha256')
     and se.expires_at > now()
     and st.active and b.activo;
  if not found then
    raise exception 'SESION_CADUCADA';
  end if;
  return s;
end $$;

-- Igual, pero exige uno de los roles indicados.
create or replace function privado.exigir_rol(p_token text, p_roles text[])
returns comun.staff
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s comun.staff;
begin
  s := privado.staff_de_token(p_token);
  if not (s.role = any (p_roles)) then
    raise exception 'SIN_PERMISO';
  end if;
  return s;
end $$;


revoke all on all tables in schema comun, multibar, autonomialab from public, anon, authenticated;

commit;
