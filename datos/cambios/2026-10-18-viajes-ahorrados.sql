-- =====================================================================
-- CAMBIO 18 oct 2026 · Viajes ahorrados en el resumen del día (v22)
-- ---------------------------------------------------------------------
-- El resumen del día del panel enseña cuántos viajes a la mesa se ha
-- ahorrado el camarero: los pedidos que hicieron los clientes desde su
-- móvil. Para no contar los que mete el personal desde el panel, cada
-- pedido guarda si viene del panel (desde_panel).
--   · columna nueva multibar.pedidos_multibar.desde_panel (por defecto false;
--     los pedidos de antes quedan como «del cliente»: no se puede saber)
--   · panel_crear_pedido_multibar la pone a true en sus partes
--   · pedido_json la devuelve (las respuestas de siempre siguen igual,
--     solo llevan un dato más)
-- Sin DELETE ni DROP. Se puede volver a ejecutar.
-- =====================================================================
begin;

alter table multibar.pedidos_multibar
  add column if not exists desde_panel boolean not null default false;

create or replace function privado.pedido_json(p_id bigint)
returns jsonb
language sql stable security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
  select jsonb_build_object(
    'id', o.id,
    'numero', coalesce(o.numero, o.id),
    'destino', o.destino,
    'parte_de', o.parte_de,
    'desde_panel', o.desde_panel,
    'cobrado', o.cobrado_at,
    'mesa', o.mesa_id,
    'mesa_nombre', m.name,
    'ronda', o.round_number,
    'estado', o.status,
    'total', o.total,
    'creado', o.created_at,
    'modificado', o.modified_at,
    'en_preparacion', o.received_at,
    'aceptado_por', o.received_by,
    'auto', o.auto_aceptado,
    'servido', o.served_at,
    'servido_por', o.served_by,
    'editable_seg', case when o.status = 'enviado'
                         then greatest(0, 180 - floor(extract(epoch from now() - o.created_at)))::int
                         else 0 end,
    'lineas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'producto', i.product_id, 'nombre', i.product_name,
               'tamano', i.size, 'precio', i.unit_price, 'cantidad', i.quantity,
               'nota', i.note) order by i.id)
        from lineas_pedido_multibar i where i.order_id = o.id), '[]'::jsonb)
  )
  from pedidos_multibar o join mesas_multibar m on m.negocio_id = o.negocio_id and m.id = o.mesa_id
  where o.id = p_id
$$;

create or replace function public.panel_crear_pedido_multibar(p_token text, p_mesa integer, p_lineas jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s usuarios_multibar; v_partes jsonb;
begin
  s := privado.exigir_rol(p_token, array['camarero','barra','admin']);
  perform 1 from mesas_multibar where negocio_id = s.negocio_id and id = p_mesa;
  if not found then
    raise exception 'MESA_NO_VALIDA';
  end if;
  -- Igual que en la carta: con «barra y cocina» se divide en dos partes.
  v_partes := privado.crear_partes(s.negocio_id, p_mesa, 1, gen_random_uuid(), p_lineas);
  -- Marca que lo metió el personal (el resumen del día no lo cuenta como viaje ahorrado; v22).
  update pedidos_multibar set desde_panel = true
   where id in (select (x->>'id')::bigint from jsonb_array_elements(v_partes) x);
  select jsonb_agg(privado.pedido_json((x->>'id')::bigint) order by n) into v_partes
    from jsonb_array_elements(v_partes) with ordinality as t(x, n);
  return (v_partes->0) || jsonb_build_object('partes', v_partes);
end $$;

commit;
