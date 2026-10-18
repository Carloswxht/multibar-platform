-- =====================================================================
-- SEGURIDAD, LOGIN Y PERMISOS POR ROL · MultiBar
-- ---------------------------------------------------------------------
-- Ejecutar después de datos/esquema.sql y datos/datos-iniciales.sql, y
-- a continuación datos/funciones.sql (las ventanillas y sus permisos).
--
-- CÓMO FUNCIONA (resumen para no programadores)
-- * Las tablas están cerradas: la web NO puede leer ni escribir ninguna
--   tabla directamente (seguridad por fila activada y sin permisos).
-- * La web solo puede llamar a una lista cerrada de "ventanillas"
--   (funciones, en datos/funciones.sql) que comprueban todo antes de
--   tocar nada, y siempre dentro de UN bar:
--     - Cliente de la mesa (sin login): ver la carta, crear SU pedido
--       con el código secreto de la mesa, editarlo mientras siga
--       "enviado" y no hayan pasado 3 minutos, y ver solo sus pedidos.
--     - Camarero: ver pedidos, marcar En preparación / Servido / Deshacer
--       modificar pedidos (quitar productos a 0) y crear pedidos nuevos
--       para una mesa (entran como NUEVOS, igual que los del cliente).
--     - Barra: lo del camarero + marcar productos agotados.
--     - Admin: todo lo anterior + precios, productos, mesas y usuarios
--       (de su bar).
-- * El precio lo pone siempre la base, nunca el móvil del cliente.
-- * Límites anti-spam: 1 pedido cada 20 s y 10 por hora por móvil,
--   6 pedidos cada 10 min por mesa, 30 líneas y 20 unidades por línea.
-- * Login del personal con correo y contraseña, guardado en la propia
--   base (sin cookies, para que funcione igual en Safari/iPhone). La
--   contraseña va cifrada (bcrypt); 5 fallos seguidos bloquean 15 min;
--   la sesión dura 16 h (un turno largo).
-- * Limpieza automática: pedidos de más de 30 días se borran y las notas
--   de más de 24 h se vacían (por si alguien escribe datos personales).
--
-- PARA MIGRAR A SUPABASE: este archivo se rehace. Las tablas y los datos
-- (esquema.sql, datos-iniciales.sql) se reutilizan tal cual.
-- Tras aplicar cambios aquí, esperar 30–60 s antes de probar desde la web.
-- =====================================================================

-- ---------------- ZONA PRIVADA (no se publica en la web) ----------------
create schema if not exists privado;
revoke all on schema privado from public, anon, authenticated;

-- Cifrado (pgcrypto). Las funciones siempre lo llaman como privado.crypt,
-- privado.digest… Si pgcrypto no está instalado, se instala en "privado";
-- si ya está en otro sitio (Supabase lo trae en "extensions"), se crean en
-- "privado" unos atajos que llaman a ese.
do $$
declare esq text;
begin
  select n.nspname into esq from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pgcrypto';
  if esq is null then
    create extension pgcrypto schema privado;
  elsif esq <> 'privado' then
    execute format('create function privado.crypt(text, text) returns text language sql immutable strict set search_path = pg_catalog as $f$ select %I.crypt($1, $2) $f$', esq);
    execute format('create function privado.gen_salt(text, integer) returns text language sql volatile strict set search_path = pg_catalog as $f$ select %I.gen_salt($1, $2) $f$', esq);
    execute format('create function privado.digest(text, text) returns bytea language sql immutable strict set search_path = pg_catalog as $f$ select %I.digest($1, $2) $f$', esq);
    execute format('create function privado.gen_random_bytes(integer) returns bytea language sql volatile strict set search_path = pg_catalog as $f$ select %I.gen_random_bytes($1) $f$', esq);
  end if;
end $$;

-- Sesiones del personal: se guarda solo la huella (hash) del token.
create table privado.sesiones (
  token_hash  bytea primary key,
  staff_id    integer not null references comun.staff(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index sesiones_staff_idx on privado.sesiones (staff_id);

-- Enlaces para recuperar la contraseña por correo (v18). Se guarda solo la
-- huella (hash) del enlace; vale 30 minutos y una sola vez.
create table privado.recuperaciones (
  token_hash  bytea primary key,
  staff_id    integer not null references comun.staff(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  usado_at    timestamptz
);
create index recuperaciones_staff_idx on privado.recuperaciones (staff_id, created_at);
alter table privado.recuperaciones enable row level security;
revoke all on privado.recuperaciones from public, anon, authenticated;

-- Las funciones nuevas no se pueden ejecutar desde la web salvo que se
-- diga expresamente (por defecto Postgres deja a todo el mundo).
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public;


-- Las funciones (ventanillas) y los permisos para la web están en
-- datos/funciones.sql: ejecutarlo ahora.
