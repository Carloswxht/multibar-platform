-- =====================================================================
-- CAMBIO 18 oct 2026 · Recomendados y carta por horario (v25)
-- ---------------------------------------------------------------------
-- Dos opciones de la plataforma, apagadas por defecto (ajustes del bar):
--   · ajustes.destacados: cada producto puede llevar la etiqueta
--     «recomendado», «del_dia» o «nuevo» (columna productos_multibar.marca),
--     que pone barra o admin desde la lista de precios del panel
--     (panel_marca_producto_multibar). La carta la recibe en carta_menu.
--   · ajustes.horarios: cada pestaña puede tener horario
--     (categorias_multibar.horario, por días y tramos, con la hora del bar);
--     la carta sabe si está abierta y crear_pedido rechaza lo que ahora no
--     se sirve (FUERA_DE_HORARIO). Los pedidos del panel no lo comprueban.
--     El admin lo cambia en el panel (admin_horarios_multibar,
--     admin_guardar_horario_multibar).
-- Con las opciones apagadas todo responde como antes. Sin borrar nada.
-- Se puede volver a ejecutar.
-- =====================================================================
begin;

alter table multibar.categorias_multibar add column if not exists horario jsonb;
alter table multibar.productos_multibar add column if not exists marca text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'productos_multibar_marca_check') then
    alter table multibar.productos_multibar
      add constraint productos_multibar_marca_check check (marca in ('recomendado','del_dia','nuevo'));
  end if;
end $$;

-- Carta por horario (v25): ¿está abierta ahora una pestaña con este horario,
-- según la hora del bar? Sin horario = siempre. Días ISO (1 = lunes … 7 =
-- domingo); sin días = todos. Un tramo que acaba antes de empezar cruza la
-- medianoche (20:00–01:00) y cuenta por el día en que empieza.
create or replace function privado.dia_en(p_h jsonb, p_dia int)
returns boolean
language sql immutable
set search_path = public, comun, multibar, privado, pg_temp
as $$
  select jsonb_typeof(p_h->'dias') is distinct from 'array' or jsonb_array_length(p_h->'dias') = 0
      or (p_h->'dias') @> to_jsonb(p_dia)
$$;
create or replace function privado.horario_abierto(p_h jsonb, p_zona text, p_t timestamptz default now())
returns boolean
language sql stable
set search_path = public, comun, multibar, privado, pg_temp
as $$
  select p_h is null or jsonb_typeof(p_h->'tramos') is distinct from 'array' or jsonb_array_length(p_h->'tramos') = 0
      or exists (
        select 1
          from jsonb_array_elements(p_h->'tramos') t,
               lateral (select (p_t at time zone p_zona) as ahora) a,
               lateral (select (t->>'desde')::time as d, (t->>'hasta')::time as h,
                               extract(isodow from a.ahora)::int as dia, a.ahora::time as hora) x
         where case
                 when x.d < x.h then
                   privado.dia_en(p_h, x.dia) and x.hora >= x.d and x.hora < x.h
                 else  -- cruza la medianoche (o el día entero si desde = hasta)
                   (privado.dia_en(p_h, x.dia) and x.hora >= x.d)
                   or (privado.dia_en(p_h, case when x.dia = 1 then 7 else x.dia - 1 end) and x.hora < x.h)
               end)
$$;

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
        'pop', p.featured, 'al', to_jsonb(p.allergens), 'img', p.photo,
        'marca', case when coalesce((b.ajustes->>'destacados')::boolean, false) then p.marca end,
        'agotado', not p.available) order by p.sort_order, p.id)
      from productos_multibar p where p.negocio_id = c.negocio_id and p.category_id = c.id and p.visible), '[]'::jsonb)
  ) order by c.sort_order), '[]'::jsonb)
  from categorias_multibar c where c.negocio_id = b.id);
end $$;

-- Crear un pedido.
create or replace function public.crear_pedido_multibar(p_bar text, p_mesa integer, p_codigo text, p_dispositivo uuid, p_lineas jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare
  b bares_multibar; v_partes jsonb; v_ronda int; v_hasta timestamptz; v_fuera text;
begin
  b := privado.bar_de_slug(p_bar);
  if p_dispositivo is null then
    raise exception 'DISPOSITIVO_NO_VALIDO';
  end if;
  -- La mesa debe ser de este bar, estar activa y el código coincidir. Se
  -- bloquea la fila de la mesa para contar los pedidos sin carreras.
  select abierta_hasta into v_hasta from mesas_multibar
   where negocio_id = b.id and id = p_mesa and active and code = p_codigo for update;
  if not found then
    raise exception 'MESA_NO_VALIDA';
  end if;
  -- Control de mesas: solo se pide si el camarero ha abierto la mesa.
  if coalesce((b.ajustes->>'control_mesas')::boolean, false)
     and (v_hasta is null or v_hasta <= now()) then
    raise exception 'MESA_CERRADA';
  end if;

  -- Límites anti-spam.
  if exists (select 1 from pedidos_multibar where device_key = p_dispositivo
              and created_at > now() - interval '20 seconds') then
    raise exception 'ESPERA_UN_MOMENTO';
  end if;
  -- (las 2.ª partes de un pedido dividido no cuentan como otro pedido)
  if (select count(*) from pedidos_multibar where device_key = p_dispositivo and parte_de is null
       and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'LIMITE_MOVIL';
  end if;
  if (select count(*) from pedidos_multibar where negocio_id = b.id and mesa_id = p_mesa and parte_de is null
       and created_at > now() - interval '10 minutes') >= 6 then
    raise exception 'LIMITE_MESA';
  end if;

  -- Carta por horario (v25): nada de una pestaña que ahora no se sirve.
  -- (Los pedidos que mete el personal desde el panel no lo comprueban.)
  if coalesce((b.ajustes->>'horarios')::boolean, false) and jsonb_typeof(p_lineas) = 'array' then
    select string_agg(distinct p.name, ', ') into v_fuera
      from jsonb_array_elements(p_lineas) l
      join productos_multibar p on p.negocio_id = b.id and p.id = (l->>'producto')::int
      join categorias_multibar c on c.negocio_id = p.negocio_id and c.id = p.category_id
     where not privado.horario_abierto(c.horario, b.zona_horaria);
    if v_fuera is not null then
      raise exception 'FUERA_DE_HORARIO';
    end if;
  end if;

  perform privado.limpiar();

  select coalesce(max(round_number), 0) + 1 into v_ronda from pedidos_multibar
   where device_key = p_dispositivo and negocio_id = b.id and mesa_id = p_mesa
     and created_at > now() - interval '12 hours';

  -- Devuelve la 1.ª parte (como siempre) y, en "partes", todas.
  v_partes := privado.crear_partes(b.id, p_mesa, v_ronda, p_dispositivo, p_lineas);
  return (v_partes->0) || jsonb_build_object('partes', v_partes);
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
            'marca', p.marca,
            'actualizado', p.updated_at, 'actualizado_por', p.updated_by)
            order by c.sort_order, p.sort_order, p.id), '[]'::jsonb)
            from productos_multibar p join categorias_multibar c on c.negocio_id = p.negocio_id and c.id = p.category_id
           where p.negocio_id = s.negocio_id);
end $$;

-- Recomendados (v25): poner o quitar la etiqueta de un producto de su bar
-- («recomendado», «del_dia», «nuevo»; vacío = sin etiqueta). Barra y admin,
-- como los agotados: el plato del día cambia cada día.
create or replace function public.panel_marca_producto_multibar(p_token text, p_producto integer, p_marca text)
returns void
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s usuarios_multibar; v text := nullif(trim(coalesce(p_marca, '')), '');
begin
  s := privado.exigir_rol(p_token, array['barra','admin']);
  if v is not null and v not in ('recomendado','del_dia','nuevo') then
    raise exception 'MARCA_NO_VALIDA';
  end if;
  update productos_multibar set marca = v, updated_at = now(), updated_by = s.name
   where id = p_producto and negocio_id = s.negocio_id;
  if not found then
    raise exception 'PRODUCTO_NO_VALIDO';
  end if;
end $$;

-- Carta por horario (v25): las pestañas de su bar con su horario y si ahora están abiertas.
create or replace function public.admin_horarios_multibar(p_token text)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s usuarios_multibar; z text;
begin
  s := privado.exigir_rol(p_token, array['admin']);
  select zona_horaria into z from bares_multibar where id = s.negocio_id;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.name, 'horario', c.horario,
                   'abierta', privado.horario_abierto(c.horario, z)) order by c.sort_order), '[]'::jsonb)
            from categorias_multibar c where c.negocio_id = s.negocio_id);
end $$;

-- Guardar el horario de una pestaña de su bar (null o sin tramos = siempre).
-- Formato: {"dias":[1..7], "tramos":[{"desde":"HH:MM","hasta":"HH:MM"}, …]} (máx. 4 tramos).
create or replace function public.admin_guardar_horario_multibar(p_token text, p_categoria text, p_horario jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s usuarios_multibar; v jsonb; t jsonb; d jsonb; v_dias jsonb := '[]'::jsonb; v_tramos jsonb := '[]'::jsonb;
begin
  s := privado.exigir_rol(p_token, array['admin']);
  if p_horario is not null and jsonb_typeof(p_horario) = 'object'
     and jsonb_typeof(p_horario->'tramos') = 'array' and jsonb_array_length(p_horario->'tramos') > 0 then
    if jsonb_array_length(p_horario->'tramos') > 4 then
      raise exception 'HORARIO_NO_VALIDO';
    end if;
    for t in select * from jsonb_array_elements(p_horario->'tramos') loop
      if coalesce(t->>'desde', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or coalesce(t->>'hasta', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        raise exception 'HORARIO_NO_VALIDO';
      end if;
      v_tramos := v_tramos || jsonb_build_array(jsonb_build_object('desde', t->>'desde', 'hasta', t->>'hasta'));
    end loop;
    if jsonb_typeof(p_horario->'dias') = 'array' then
      for d in select * from jsonb_array_elements(p_horario->'dias') loop
        if jsonb_typeof(d) <> 'number' or (d::text)::int not between 1 and 7 then
          raise exception 'HORARIO_NO_VALIDO';
        end if;
        if not v_dias @> d then v_dias := v_dias || jsonb_build_array(d); end if;
      end loop;
      if jsonb_array_length(v_dias) = 0 then
        raise exception 'HORARIO_NO_VALIDO';  -- ningún día: mejor ocultar los productos
      end if;
    end if;
    v := jsonb_build_object('dias', coalesce((select jsonb_agg(x order by (x::text)::int) from jsonb_array_elements(v_dias) x), '[1,2,3,4,5,6,7]'::jsonb),
                            'tramos', v_tramos);
  end if;
  update categorias_multibar set horario = v where negocio_id = s.negocio_id and id = p_categoria;
  if not found then
    raise exception 'CATEGORIA_NO_VALIDA';
  end if;
  return v;
end $$;

revoke execute on function privado.dia_en(jsonb, int), privado.horario_abierto(jsonb, text, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.panel_marca_producto_multibar(text, integer, text),
  public.admin_horarios_multibar(text), public.admin_guardar_horario_multibar(text, text, jsonb)
  from public;
grant execute on function public.panel_marca_producto_multibar(text, integer, text),
  public.admin_horarios_multibar(text), public.admin_guardar_horario_multibar(text, text, jsonb)
  to anon, authenticated;

commit;
