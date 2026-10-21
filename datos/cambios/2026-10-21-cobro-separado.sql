-- =====================================================================
-- 21 oct 2026 · Cobrar por separado y pedidos al camarero (v34)
-- ---------------------------------------------------------------------
-- Opción nueva de la plataforma, apagada por defecto: cobro_separado.
--   * Panel, «Cuentas de mesas»: la cuenta de cada mesa sale también por
--     persona (Móvil 1, Móvil 2… y «Pedidos al camarero»), cada una con su
--     «Cobrar esto» (usa panel_cobrar_multibar con solo sus pedidos).
--   * Carta: el móvil sabe qué número es en la mesa, ve lo que ya está
--     pagado y ve aparte lo que la mesa ha pedido al camarero.
-- Base: privado.moviles_mesa, privado.grupos_cuenta y
-- public.carta_cuenta_multibar (nuevas); panel_cuentas_multibar devuelve
-- además «grupos»; panel_cobrar_multibar solo da por atendidos los avisos
-- de la mesa cuando ya no queda nada servido sin cobrar;
-- carta_pedido_mesa_multibar devuelve además lineas_moviles y
-- lineas_camarero; plataforma_opciones_multibar acepta cobro_separado.
-- La web v33 sigue funcionando igual (solo hay campos de más). Sin DELETE
-- ni DROP. Se puede volver a ejecutar entero.
-- =====================================================================

begin;

-- Cobrar por separado (v34, opción cobro_separado): cada móvil de la mesa
-- lleva un número (Móvil 1, 2…) por orden de su primer pedido de hoy; lo
-- metido por el personal desde el panel va aparte («al camarero»).
create or replace function privado.moviles_mesa(p_bar integer, p_mesa integer)
returns table(device_key uuid, n integer)
language sql stable security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
  select o.device_key, (row_number() over (order by min(o.created_at)))::integer
    from pedidos_multibar o
   where o.negocio_id = p_bar and o.mesa_id = p_mesa and not o.desde_panel
     and o.created_at > privado.desde_hoy(p_bar)
   group by o.device_key
$$;

-- Lo de una mesa sin cobrar, por persona: un grupo por móvil y otro para lo
-- pedido al camarero (movil 0, al final). Igual que la cuenta de la mesa:
-- solo se cobra lo servido.
create or replace function privado.grupos_cuenta(p_bar integer, p_mesa integer)
returns jsonb
language sql stable security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
  with ped as (
    select o.id, o.total, o.status, case when o.desde_panel then 0 else mv.n end as movil
      from pedidos_multibar o
      left join privado.moviles_mesa(p_bar, p_mesa) mv on mv.device_key = o.device_key and not o.desde_panel
     where o.negocio_id = p_bar and o.mesa_id = p_mesa and o.cobrado_at is null
       and o.created_at > privado.desde_hoy(p_bar)
  ), g as (
    select movil,
           coalesce(sum(total) filter (where status = 'servido'), 0) as total,
           coalesce(sum(total) filter (where status <> 'servido'), 0) as pendiente,
           count(*) filter (where status <> 'servido') as sin_servir,
           coalesce(array_agg(id order by id) filter (where status = 'servido'), '{}') as servidos,
           coalesce(array_agg(id order by id) filter (where status <> 'servido'), '{}') as no_servidos
      from ped group by movil
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'movil', movil, 'camarero', movil = 0, 'total', total, 'pendiente', pendiente,
           'sin_servir', sin_servir, 'ids', to_jsonb(servidos),
           'lineas', privado.lineas_juntas(servidos),
           'lineas_pendientes', privado.lineas_juntas(no_servidos)) order by movil = 0, movil), '[]'::jsonb)
    from g
$$;

-- Para la carta (v34, opción cobro_separado): qué número de móvil es este
-- en la mesa (para que el camarero lo encuentre al cobrar) y los pedidos que
-- la mesa ha hecho al camarero hoy y siguen sin cobrar. Con el código del QR.
create or replace function public.carta_cuenta_multibar(p_bar text, p_mesa integer, p_codigo text, p_dispositivo uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare b bares_multibar; v_hasta timestamptz;
begin
  b := privado.bar_de_slug(p_bar);
  if not coalesce((b.ajustes->>'cobro_separado')::boolean, false) then
    raise exception 'FUNCION_NO_ACTIVA';
  end if;
  select abierta_hasta into v_hasta from mesas_multibar
   where negocio_id = b.id and id = p_mesa and active and code = p_codigo;
  if not found then
    raise exception 'MESA_NO_VALIDA';
  end if;
  if coalesce((b.ajustes->>'control_mesas')::boolean, false)
     and (v_hasta is null or v_hasta <= now()) then
    return jsonb_build_object('movil', null, 'camarero', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'movil', (select mv.n from privado.moviles_mesa(b.id, p_mesa) mv where mv.device_key = p_dispositivo),
    'camarero', (select coalesce(jsonb_agg(privado.pedido_json(o.id) order by o.id), '[]'::jsonb)
                   from pedidos_multibar o
                  where o.negocio_id = b.id and o.mesa_id = p_mesa and o.desde_panel
                    and o.cobrado_at is null and o.created_at > privado.desde_hoy(b.id)));
end $$;

-- Cuentas de las mesas: lo pedido hoy y sin cobrar, mesa por mesa, con
-- todos los pedidos juntos (de todos los móviles, de barra y de cocina).
-- Solo se cobra lo SERVIDO: "total" y "lineas" son lo servido (con "ids",
-- los pedidos que se cobrarán); lo que aún no se ha servido va aparte en
-- "pendiente" y "lineas_pendientes" y no se cobra todavía.
create or replace function public.panel_cuentas_multibar(p_token text)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s usuarios_multibar; v_desde timestamptz;
begin
  s := privado.exigir_rol(p_token, array['camarero','barra','admin']);
  v_desde := privado.desde_hoy(s.negocio_id);
  return (select coalesce(jsonb_agg(c order by c->>'desde'), '[]'::jsonb) from (
    select jsonb_build_object(
      'mesa', t.mesa_id, 'mesa_nombre', t.nombre,
      'total', t.total, 'pendiente', t.pendiente,
      'pedidos', t.pedidos, 'sin_servir', t.sin_servir, 'desde', t.desde,
      'ids', to_jsonb(t.servidos),
      'lineas', privado.lineas_juntas(t.servidos),
      'lineas_pendientes', privado.lineas_juntas(t.no_servidos),
      'grupos', privado.grupos_cuenta(s.negocio_id, t.mesa_id)) as c
      from (select o.mesa_id, min(m.name) as nombre, min(o.created_at) as desde,
                   coalesce(sum(o.total) filter (where o.status = 'servido'), 0) as total,
                   coalesce(sum(o.total) filter (where o.status <> 'servido'), 0) as pendiente,
                   count(distinct coalesce(o.parte_de, o.id)) as pedidos,
                   count(*) filter (where o.status <> 'servido') as sin_servir,
                   coalesce(array_agg(o.id order by o.id) filter (where o.status = 'servido'), '{}') as servidos,
                   coalesce(array_agg(o.id order by o.id) filter (where o.status <> 'servido'), '{}') as no_servidos
              from pedidos_multibar o join mesas_multibar m on m.negocio_id = o.negocio_id and m.id = o.mesa_id
             where o.negocio_id = s.negocio_id and o.cobrado_at is null and o.created_at > v_desde
             group by o.mesa_id) t) u);
end $$;

-- Cobrar la cuenta de una mesa: SOLO los pedidos que el camarero tenía en
-- pantalla (p_pedidos), que sigan servidos y sin cobrar. Así no se cobra
-- nada sin servir ni un pedido que acaba de llegar. Atiende los avisos de
-- la mesa. Todos quedan con la misma hora de cobro (para poder reabrir).
-- p_pedidos: lista JSON de ids, p. ej. [71, 72].
create or replace function public.panel_cobrar_multibar(p_token text, p_mesa integer, p_pedidos jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s usuarios_multibar; v_n int; v_total numeric; v_ids bigint[];
begin
  s := privado.exigir_rol(p_token, array['camarero','barra','admin']);
  select coalesce(array_agg(x::bigint), '{}') into v_ids
    from jsonb_array_elements_text(case when jsonb_typeof(p_pedidos) = 'array' then p_pedidos else '[]'::jsonb end) x
   where x ~ '^[0-9]{1,18}$';
  update pedidos_multibar set cobrado_at = now(), cobrado_por = s.name
   where negocio_id = s.negocio_id and mesa_id = p_mesa and id = any(v_ids)
     and status = 'servido' and cobrado_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'NADA_QUE_COBRAR';
  end if;
  select sum(total) into v_total from pedidos_multibar
   where negocio_id = s.negocio_id and mesa_id = p_mesa and cobrado_at = now();
  -- Cobrando a una sola persona (v34) los avisos siguen hasta cobrar al resto.
  if not exists (select 1 from pedidos_multibar
                  where negocio_id = s.negocio_id and mesa_id = p_mesa and status = 'servido'
                    and cobrado_at is null and created_at > privado.desde_hoy(s.negocio_id)) then
    update avisos_multibar set atendido_at = now(), atendido_por = s.name
     where negocio_id = s.negocio_id and mesa_id = p_mesa and atendido_at is null;
  end if;
  return jsonb_build_object('cobrados', v_n, 'total', v_total);
end $$;

-- Lo pedido en tu mesa (v31, opción pedido_mesa): lo que lleva pedido hoy
-- toda la mesa, de todos los móviles, sin cobrar (lo mismo que su cuenta en
-- el panel, servido o no). Con el código del QR; sin decir quién pidió qué.
-- Con el control de mesas y la mesa cerrada no se enseña nada.
create or replace function public.carta_pedido_mesa_multibar(p_bar text, p_mesa integer, p_codigo text)
returns jsonb
language plpgsql stable security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare b bares_multibar; v_hasta timestamptz; v_ids bigint[];
begin
  b := privado.bar_de_slug(p_bar);
  if not coalesce((b.ajustes->>'pedido_mesa')::boolean, false) then
    raise exception 'FUNCION_NO_ACTIVA';
  end if;
  select abierta_hasta into v_hasta from mesas_multibar
   where negocio_id = b.id and id = p_mesa and active and code = p_codigo;
  if not found then
    raise exception 'MESA_NO_VALIDA';
  end if;
  if coalesce((b.ajustes->>'control_mesas')::boolean, false)
     and (v_hasta is null or v_hasta <= now()) then
    return jsonb_build_object('pedidos', 0, 'total', 0, 'lineas', '[]'::jsonb);
  end if;
  select coalesce(array_agg(o.id order by o.id), '{}') into v_ids
    from pedidos_multibar o
   where o.negocio_id = b.id and o.mesa_id = p_mesa and o.cobrado_at is null
     and o.created_at > privado.desde_hoy(b.id);
  return jsonb_build_object(
    'pedidos', (select count(distinct coalesce(o.parte_de, o.id)) from pedidos_multibar o where o.id = any(v_ids)),
    'total', (select coalesce(sum(o.total), 0) from pedidos_multibar o where o.id = any(v_ids)),
    'lineas', privado.lineas_juntas(v_ids),
    -- v34: lo de los móviles y lo pedido al camarero, por separado.
    'lineas_moviles', privado.lineas_juntas(array(select o.id from pedidos_multibar o where o.id = any(v_ids) and not o.desde_panel)),
    'lineas_camarero', privado.lineas_juntas(array(select o.id from pedidos_multibar o where o.id = any(v_ids) and o.desde_panel)));
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
                           'otra_ronda','alergenos','mas_pedidos','carta_hora','bienvenida','raciones',
                           'pestanas_cuadricula','buscador','pedido_mesa','letra_grande','cobro_separado'] loop
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

revoke execute on function public.carta_cuenta_multibar(text, integer, text, uuid) from public;
grant execute on function public.carta_cuenta_multibar(text, integer, text, uuid) to anon, authenticated;

commit;
