-- =====================================================================
-- CAMBIO 18 oct 2026 · Fotos de los productos (v26)
-- ---------------------------------------------------------------------
-- Opción de la plataforma ajustes.fotos, apagada por defecto:
--   · carpeta pública «fotos» en Storage (máx. 1 MB, solo JPEG; nadie puede
--     listarla ni subir desde la web: sube la Edge Function «subir-foto»
--     con la clave secreta, en fotos/<bar>/<producto>-<al azar>.jpg);
--   · foto_producto_multibar (solo para el servidor): comprueba que el token
--     es de un admin del bar con la opción encendida y guarda o quita la
--     dirección de la foto (columna productos_multibar.photo, que ya existía);
--   · carta_menu solo manda la foto si el bar tiene la opción encendida;
--     panel_productos la devuelve («foto») para el panel.
-- Sin borrar nada. Se puede volver a ejecutar. La parte 1 es solo de
-- Supabase (en una base sin Storage, saltarla).
-- =====================================================================
begin;

-- 1. Carpeta de fotos (solo Supabase)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', true, 1048576, array['image/jpeg'])
on conflict (id) do nothing;

-- 2. Funciones
-- La carta: pestañas y productos visibles, con precio y si están agotados.
create or replace function public.carta_menu_multibar(p_bar text)
returns jsonb
language plpgsql stable security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare b bares_multibar;
begin
  b := privado.bar_de_slug(p_bar);
  -- Con las opciones del bar encendidas (v25): el horario de cada pestaña y si
  -- ahora está abierta (ajustes.horarios), y la etiqueta de cada producto
  -- (ajustes.destacados). Apagadas, la carta sale como siempre.
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'multi', c.multi, 'fam', c.fam, 'labs', to_jsonb(c.labs),
    'horario', case when coalesce((b.ajustes->>'horarios')::boolean, false) then c.horario end,
    'abierta', not coalesce((b.ajustes->>'horarios')::boolean, false) or privado.horario_abierto(c.horario, b.zona_horaria),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'dbId', p.id, 'n', p.name, 'dn', p.display_name, 'd', p.description,
        'p', p.price, 'size', p.size, 'only', p.only_size, 'sec', p.section,
        'pop', p.featured, 'al', to_jsonb(p.allergens),
        'img', case when coalesce((b.ajustes->>'fotos')::boolean, false) then p.photo else '' end,
        'marca', case when coalesce((b.ajustes->>'destacados')::boolean, false) then p.marca end,
        'agotado', not p.available) order by p.sort_order, p.id)
      from productos_multibar p where p.negocio_id = c.negocio_id and p.category_id = c.id and p.visible), '[]'::jsonb)
  ) order by c.sort_order), '[]'::jsonb)
  from categorias_multibar c where c.negocio_id = b.id);
end $$;

-- Lista completa de productos de su bar (con los ocultos) para barra y admin.
create or replace function public.panel_productos_multibar(p_token text)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s usuarios_multibar;
begin
  s := privado.exigir_rol(p_token, array['barra','admin']);
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', p.id, 'categoria', p.category_id, 'nombre', p.name, 'nombre_corto', p.display_name,
            'descripcion', p.description, 'tamano', p.size, 'solo_tamano', p.only_size,
            'seccion', p.section, 'precio', p.price, 'disponible', p.available,
            'visible', p.visible, 'destacado', p.featured, 'orden', p.sort_order,
            'marca', p.marca, 'foto', p.photo,
            'actualizado', p.updated_at, 'actualizado_por', p.updated_by)
            order by c.sort_order, p.sort_order, p.id), '[]'::jsonb)
            from productos_multibar p join categorias_multibar c on c.negocio_id = p.negocio_id and c.id = p.category_id
           where p.negocio_id = s.negocio_id);
end $$;

-- Fotos de los productos (v26, opción ajustes.fotos). Solo la llama la
-- función del servidor «subir-foto» (con la clave secreta): la web no puede
-- poner la dirección que quiera. Con p_url null solo comprueba que el token
-- es de un admin de ese bar con la opción encendida (antes de subir nada);
-- con una dirección de la carpeta «fotos» de su bar la guarda; con '' la quita.
create or replace function public.foto_producto_multibar(p_token text, p_producto integer, p_url text)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s usuarios_multibar;
begin
  s := privado.exigir_rol(p_token, array['admin']);
  if not coalesce((select (ajustes->>'fotos')::boolean from bares_multibar where id = s.negocio_id), false) then
    raise exception 'FUNCION_NO_ACTIVA';
  end if;
  perform 1 from productos_multibar where id = p_producto and negocio_id = s.negocio_id;
  if not found then
    raise exception 'PRODUCTO_NO_VALIDO';
  end if;
  if p_url is null then
    return jsonb_build_object('negocio', s.negocio_id);
  end if;
  if p_url <> '' and p_url !~ ('^https://[a-z0-9.-]+/storage/v1/object/public/fotos/' || s.negocio_id || '/' || p_producto || '-[a-z0-9]{6,40}\.jpg$') then
    raise exception 'FOTO_NO_VALIDA';
  end if;
  update productos_multibar set photo = p_url, updated_at = now(), updated_by = s.name
   where id = p_producto and negocio_id = s.negocio_id;
  return jsonb_build_object('negocio', s.negocio_id, 'foto', p_url);
end $$;

revoke execute on function public.foto_producto_multibar(text, integer, text) from public, anon, authenticated;
grant execute on function public.foto_producto_multibar(text, integer, text) to service_role;

commit;
