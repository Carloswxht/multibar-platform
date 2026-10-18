-- =====================================================================
-- 18 oct 2026 · Carta más fácil, entrega 1 (v30)
-- ---------------------------------------------------------------------
-- Seis opciones nuevas de la plataforma, apagadas por defecto (con ellas
-- apagadas la carta sale como siempre):
--   otra_ronda   «Repetir el último pedido» con un toque (solo en la carta).
--   alergenos    los 14 alérgenos por producto, con iconos y filtro.
--   mas_pedidos  portada «Lo mejor» con lo más pedido en 30 días (y los recomendados).
--   carta_hora   las pestañas que se sirven ahora, primero (usa los horarios).
--   bienvenida   mensaje de 3 pasos la primera vez que se abre la carta con el QR.
--   raciones     «para 2–3 personas» en cada producto.
-- Base: columna productos_multibar.racion; carta_menu_multibar manda
-- al / rac / top según las opciones; el panel guarda alérgenos (por plato:
-- se copian a sus otros tamaños) y ración; plataforma_opciones_multibar
-- acepta las claves nuevas; el alta de un bar copia también la ración.
-- Sin borrar nada. Se puede volver a ejecutar entero.
-- =====================================================================

begin;

alter table multibar.productos_multibar add column if not exists racion text check (char_length(racion) <= 40);

-- La carta: pestañas y productos visibles, con precio y si están agotados.
create or replace function public.carta_menu_multibar(p_bar text)
returns jsonb
language plpgsql stable security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare b bares_multibar; v_top jsonb := '{}'::jsonb;
begin
  b := privado.bar_de_slug(p_bar);
  -- Lo más pedido (v30, ajustes.mas_pedidos): los 8 productos que más se han
  -- pedido en este bar en los últimos 30 días (en al menos 2 pedidos), con su puesto.
  if coalesce((b.ajustes->>'mas_pedidos')::boolean, false) then
    select coalesce(jsonb_object_agg(t.product_id::text, t.puesto), '{}'::jsonb) into v_top
      from (select l.product_id, row_number() over (order by sum(l.quantity) desc, l.product_id) as puesto
              from lineas_pedido_multibar l join pedidos_multibar o on o.id = l.order_id
             where o.negocio_id = b.id and o.created_at > now() - interval '30 days' and l.quantity > 0
             group by l.product_id having count(distinct o.id) >= 2
             order by sum(l.quantity) desc, l.product_id limit 8) t;
  end if;
  -- Con las opciones del bar encendidas (v25): el horario de cada pestaña y si
  -- ahora está abierta (ajustes.horarios), y la etiqueta de cada producto
  -- (ajustes.destacados). Apagadas, la carta sale como siempre. v30: alérgenos
  -- (ajustes.alergenos), ración (ajustes.raciones) y puesto en lo más pedido.
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'multi', c.multi, 'fam', c.fam, 'labs', to_jsonb(c.labs),
    'horario', case when coalesce((b.ajustes->>'horarios')::boolean, false) then c.horario end,
    'abierta', not coalesce((b.ajustes->>'horarios')::boolean, false) or privado.horario_abierto(c.horario, b.zona_horaria),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'dbId', p.id, 'n', p.name, 'dn', p.display_name, 'd', p.description,
        'p', p.price, 'size', p.size, 'only', p.only_size, 'sec', p.section,
        'pop', p.featured,
        'al', case when coalesce((b.ajustes->>'alergenos')::boolean, false) then coalesce(to_jsonb(p.allergens), '[]'::jsonb) end,
        'rac', case when coalesce((b.ajustes->>'raciones')::boolean, false) then p.racion end,
        'top', (v_top->>p.id::text)::int,
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
            'alergenos', coalesce(to_jsonb(p.allergens), '[]'::jsonb), 'racion', p.racion,
            'actualizado', p.updated_at, 'actualizado_por', p.updated_by)
            order by c.sort_order, p.sort_order, p.id), '[]'::jsonb)
            from productos_multibar p join categorias_multibar c on c.negocio_id = p.negocio_id and c.id = p.category_id
           where p.negocio_id = s.negocio_id);
end $$;

-- Crear (sin "id") o cambiar (con "id") un producto de su bar: precio,
-- nombre, visible, etc. Los productos no se borran: se ocultan
-- (visible = false), para no romper pedidos antiguos.
create or replace function public.admin_guardar_producto_multibar(p_token text, p_datos jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s usuarios_multibar; v_id int; d jsonb := coalesce(p_datos, '{}'::jsonb); v_al text[]; p productos_multibar;
begin
  s := privado.exigir_rol(p_token, array['admin']);
  -- Alérgenos (v30): los 14 de la normativa europea, por su código.
  if d ? 'alergenos' then
    if jsonb_typeof(d->'alergenos') <> 'array' then
      raise exception 'DATOS_NO_VALIDOS';
    end if;
    select coalesce(array_agg(distinct a order by a), '{}') into v_al from jsonb_array_elements_text(d->'alergenos') a;
    if exists (select 1 from unnest(v_al) a where a not in ('gluten','crustaceos','huevo','pescado','cacahuetes','soja',
               'lacteos','frutos_cascara','apio','mostaza','sesamo','sulfitos','altramuces','moluscos')) then
      raise exception 'DATOS_NO_VALIDOS';
    end if;
  end if;
  if char_length(btrim(coalesce(d->>'racion', ''))) > 40 then
    raise exception 'DATOS_NO_VALIDOS';
  end if;
  -- La pestaña tiene que ser de su bar.
  if d->>'categoria' is not null
     and not exists (select 1 from categorias_multibar where negocio_id = s.negocio_id and id = d->>'categoria') then
    raise exception 'FALTAN_DATOS';
  end if;
  if d ? 'id' and d->>'id' is not null then
    update productos_multibar set
      category_id  = coalesce(d->>'categoria', category_id),
      name         = coalesce(nullif(btrim(d->>'nombre'), ''), name),
      display_name = case when d ? 'nombre_corto' then nullif(btrim(d->>'nombre_corto'), '') else display_name end,
      description  = coalesce(d->>'descripcion', description),
      size         = case when d ? 'tamano' then nullif(d->>'tamano', '') else size end,
      only_size    = coalesce((d->>'solo_tamano')::boolean, only_size),
      section      = coalesce(d->>'seccion', section),
      price        = coalesce((d->>'precio')::numeric, price),
      available    = coalesce((d->>'disponible')::boolean, available),
      visible      = coalesce((d->>'visible')::boolean, visible),
      featured     = coalesce((d->>'destacado')::boolean, featured),
      sort_order   = coalesce((d->>'orden')::int, sort_order),
      allergens    = case when d ? 'alergenos' then v_al else allergens end,
      racion       = case when d ? 'racion' then nullif(btrim(d->>'racion'), '') else racion end,
      updated_at   = now(), updated_by = s.name
    where id = (d->>'id')::int and negocio_id = s.negocio_id
    returning id into v_id;
    if v_id is null then
      raise exception 'PRODUCTO_NO_VALIDO';
    end if;
  else
    if nullif(btrim(d->>'nombre'), '') is null or d->>'categoria' is null or d->>'precio' is null then
      raise exception 'FALTAN_DATOS';
    end if;
    insert into productos_multibar (negocio_id, category_id, name, display_name, description, size, only_size, section,
                          price, available, visible, featured, sort_order, updated_by, allergens, racion)
    values (s.negocio_id, d->>'categoria', btrim(d->>'nombre'), nullif(btrim(d->>'nombre_corto'), ''),
            coalesce(d->>'descripcion', ''), nullif(d->>'tamano', ''),
            coalesce((d->>'solo_tamano')::boolean, false), coalesce(d->>'seccion', ''),
            (d->>'precio')::numeric, coalesce((d->>'disponible')::boolean, true),
            coalesce((d->>'visible')::boolean, true), coalesce((d->>'destacado')::boolean, false),
            coalesce((d->>'orden')::int, (select coalesce(max(sort_order), 0) + 1 from productos_multibar where negocio_id = s.negocio_id)),
            s.name, case when d ? 'alergenos' then v_al end, nullif(btrim(d->>'racion'), ''))
    returning id into v_id;
  end if;
  -- Los alérgenos son del plato: se ponen igual en sus otros tamaños (Tapa / Plato…).
  if d ? 'alergenos' then
    select * into p from productos_multibar where id = v_id;
    if p.display_name is not null and p.size is not null then
      update productos_multibar set allergens = v_al
       where negocio_id = s.negocio_id and category_id = p.category_id and display_name = p.display_name
         and size is not null and id <> v_id;
    end if;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

-- Encender o apagar opciones de un bar. Solo estas claves; el resto de sus
-- ajustes (aspecto, pie, datos legales…) no se toca.
create or replace function public.plataforma_opciones_multibar(p_token text, p_bar integer, p_opciones jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare v jsonb := '{}'::jsonb; k text;
begin
  perform privado.plataforma_de_token(p_token);
  perform 1 from bares_multibar where id = p_bar;
  if not found then
    raise exception 'BAR_NO_VALIDO';
  end if;
  if p_opciones is null or jsonb_typeof(p_opciones) <> 'object' then
    raise exception 'FALTAN_DATOS';
  end if;
  foreach k in array array['barra_cocina','avisos_mesa','cuentas_mesa','control_mesas','destacados','horarios','fotos',
                           'otra_ronda','alergenos','mas_pedidos','carta_hora','bienvenida','raciones'] loop
    if p_opciones ? k then
      if jsonb_typeof(p_opciones->k) <> 'boolean' then
        raise exception 'OPCION_NO_VALIDA';
      end if;
      v := v || jsonb_build_object(k, p_opciones->k);
    end if;
  end loop;
  if p_opciones ? 'horas_mesa' then
    if jsonb_typeof(p_opciones->'horas_mesa') <> 'number'
       or (p_opciones->>'horas_mesa')::numeric not in (1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24) then
      raise exception 'OPCION_NO_VALIDA';
    end if;
    v := v || jsonb_build_object('horas_mesa', (p_opciones->>'horas_mesa')::int);
  end if;
  if p_opciones ? 'numeracion' then
    if coalesce(p_opciones->>'numeracion', '') not in ('diaria', 'continua') then
      raise exception 'OPCION_NO_VALIDA';
    end if;
    v := v || jsonb_build_object('numeracion', p_opciones->>'numeracion');
  end if;
  insert into ajustes_multibar (negocio_id, ajustes) values (p_bar, v)
  on conflict (negocio_id) do update set ajustes = ajustes_multibar.ajustes || excluded.ajustes;
  return (select ajustes from ajustes_multibar where negocio_id = p_bar);
end $$;

-- Alta de un bar nuevo: negocio, MultiBar contratado, ajustes vacíos (aspecto
-- neutro de MultiBar), carta (copia de la carta de otro bar, sin fotos ni
-- etiquetas, o una pestaña «CARTA» vacía), mesas 1..N con su código de QR y
-- el usuario admin del dueño con una contraseña provisional al azar (la elige
-- él con el correo de bienvenida). No copia nada más del otro bar (ni su
-- aspecto, ni sus opciones, ni sus datos legales).
-- p_datos: {nombre, slug, mesas, email, dueno, copiar_de?, zona_horaria?}
create or replace function public.plataforma_alta_bar_multibar(p_token text, p_datos jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare
  v_nombre text := btrim(coalesce(p_datos->>'nombre', ''));
  v_slug   text := lower(btrim(coalesce(p_datos->>'slug', '')));
  v_email  text := lower(btrim(coalesce(p_datos->>'email', '')));
  v_dueno  text := btrim(coalesce(p_datos->>'dueno', ''));
  v_zona   text := coalesce(nullif(btrim(p_datos->>'zona_horaria'), ''), 'Europe/Madrid');
  v_mesas  int; v_origen int; v_id int; v_uid int;
begin
  perform privado.plataforma_de_token(p_token);
  if v_nombre = '' or length(v_nombre) > 60 then
    raise exception 'FALTAN_DATOS';
  end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,39}$'
     or v_slug in ('autonomialab', 'plataforma', 'panel', 'carta', 'legal', 'admin', 'www', 'multibar') then
    raise exception 'SLUG_NO_VALIDO';
  end if;
  if exists (select 1 from comun.negocios where slug = v_slug) then
    raise exception 'SLUG_EN_USO';
  end if;
  if coalesce(p_datos->>'mesas', '10') !~ '^[0-9]{1,3}$' then
    raise exception 'MESAS_NO_VALIDAS';
  end if;
  v_mesas := coalesce((p_datos->>'mesas')::int, 10);
  if v_mesas not between 1 and 200 then
    raise exception 'MESAS_NO_VALIDAS';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'EMAIL_NO_VALIDO';
  end if;
  if exists (select 1 from comun.usuarios where lower(email) = v_email) then
    raise exception 'EMAIL_EN_USO';
  end if;
  if v_dueno = '' then
    v_dueno := 'Administrador';
  end if;
  if not exists (select 1 from pg_timezone_names where name = v_zona) then
    raise exception 'FALTAN_DATOS';
  end if;
  if nullif(p_datos->>'copiar_de', '') is not null then
    select id into v_origen from bares_multibar where slug = p_datos->>'copiar_de';
    if not found then
      raise exception 'BAR_NO_VALIDO';
    end if;
  end if;

  insert into comun.negocios (slug, nombre, tipo, zona_horaria)
  values (v_slug, v_nombre, 'multibar', v_zona) returning id into v_id;
  insert into comun.productos_contratados (negocio_id, producto) values (v_id, 'multibar');
  insert into ajustes_multibar (negocio_id, subtitulo, ajustes) values (v_id, '', '{}'::jsonb);
  if v_origen is not null then
    insert into categorias_multibar (negocio_id, id, name, sort_order, multi, fam, labs, destino)
    select v_id, id, name, sort_order, multi, fam, labs, destino
      from categorias_multibar where negocio_id = v_origen;
    insert into productos_multibar (negocio_id, category_id, name, display_name, description, size, only_size,
                                    section, price, visible, allergens, racion, sort_order, updated_by)
    select v_id, category_id, name, display_name, description, size, only_size,
           section, price, visible, allergens, racion, sort_order, 'plataforma'
      from productos_multibar where negocio_id = v_origen order by id;
  end if;
  if not exists (select 1 from categorias_multibar where negocio_id = v_id) then
    insert into categorias_multibar (negocio_id, id, name, sort_order) values (v_id, 'carta', 'CARTA', 1);
  end if;
  insert into mesas_multibar (negocio_id, id, name)
  select v_id, g, 'Mesa ' || g from generate_series(1, v_mesas) g;
  insert into comun.usuarios (negocio_id, email, name, password_hash, must_change_password)
  values (v_id, v_email, v_dueno,
          privado.crypt(encode(privado.gen_random_bytes(24), 'hex'), privado.gen_salt('bf', 10)), true)
  returning id into v_uid;
  insert into personal_multibar (usuario_id, negocio_id, role) values (v_uid, v_id, 'admin');
  return jsonb_build_object('id', v_id, 'slug', v_slug, 'nombre', v_nombre, 'email', v_email, 'mesas', v_mesas);
end $$;

commit;
