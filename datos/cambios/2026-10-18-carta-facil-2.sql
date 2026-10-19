-- =====================================================================
-- 18 oct 2026 · Carta más fácil, entrega 2 (v31)
-- ---------------------------------------------------------------------
-- Cuatro opciones nuevas de la plataforma, apagadas por defecto (con ellas
-- apagadas la carta sale como siempre):
--   pestanas_cuadricula  al abrir, las pestañas en botones grandes (cuadrícula).
--   buscador             lupa para buscar un plato en toda la carta.
--   pedido_mesa          en el tique, «En tu mesa hoy»: lo pedido por toda la mesa.
--   letra_grande         botón «A+» para agrandar la carta (cada móvil lo recuerda).
-- Base: función nueva carta_pedido_mesa_multibar (para la web, con el código
-- del QR) y plataforma_opciones_multibar acepta las claves nuevas.
-- La web v30 sigue funcionando igual. Sin DELETE ni DROP. Se puede volver a
-- ejecutar entero.
-- =====================================================================

begin;

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
    'lineas', privado.lineas_juntas(v_ids));
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
                           'pestanas_cuadricula','buscador','pedido_mesa','letra_grande'] loop
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

revoke execute on function public.carta_pedido_mesa_multibar(text, integer, text) from public;
grant execute on function public.carta_pedido_mesa_multibar(text, integer, text) to anon, authenticated;

commit;
