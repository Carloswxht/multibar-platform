-- MultiBar · 23 oct 2026 · Correos de las cuentas con la imagen de cada bar
-- (encargo de AutonomIA-Lab: docs/correos-productos.md).
-- Base: autonomialab-db (ref dorunbacwnkwdatfscri). Repositorio dueño: multibar-platform.
--
-- La Edge Function común «enviar-correo» (de AutonomIA-Lab) manda los correos del login de Supabase
-- (cambiar contraseña, bienvenida…) y pregunta a public.marca_correo(auth_id) con qué imagen salen.
-- Esa función llama sola a public.marca_correo_multibar(negocio) si existe: aquí van el logo y los
-- colores de cada bar, sacados de su aspecto (ajustes_multibar.ajustes->'aspecto'):
--   logo   → aspecto.logo o, si no tiene, aspecto.icono (las rutas de esta web pasan a dirección completa)
--   fondo  → colores.fondo · texto → colores.texto · acento (botón y franja) → colores.principal
-- Un bar sin aspecto sale con los colores neutros de MultiBar (los de comun/aspecto.js).
-- Solo la puede llamar el servidor (service_role). Sin DELETE ni DROP; se puede volver a aplicar.

create or replace function public.marca_correo_multibar(p_negocio integer) returns jsonb
language sql stable security definer set search_path = ''
as $$
  with a as (
    select coalesce(aj.ajustes->'aspecto', '{}'::jsonb) as asp
      from multibar.ajustes_multibar aj
      join comun.negocios n on n.id = aj.negocio_id
     where aj.negocio_id = p_negocio and n.tipo = 'multibar'
  ), img as (
    select asp, nullif(btrim(coalesce(nullif(btrim(asp->>'logo'), ''), asp->>'icono', '')), '') as ruta from a
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'logo', case
              when ruta ~ '^https://[^\s"''<>]+$' then ruta
              when ruta ~ '^datos/bares/[a-z0-9-]+/[A-Za-z0-9_.-]+\.(png|jpg|jpeg|webp)$'
                then 'https://carta.autonomialab.es/' || ruta
            end,
    'fondo',  coalesce(asp->'colores'->>'fondo', '#FFFFFF'),
    'texto',  coalesce(asp->'colores'->>'texto', '#1C2028'),
    'acento', coalesce(asp->'colores'->>'principal', '#22262E')))
  from img;
$$;
comment on function public.marca_correo_multibar(integer) is
  'Logo y colores de un bar para los correos de las cuentas (la llama public.marca_correo). Solo service_role.';
revoke all on function public.marca_correo_multibar(integer) from public, anon, authenticated;
grant execute on function public.marca_correo_multibar(integer) to service_role;
