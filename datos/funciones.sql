-- =====================================================================
-- FUNCIONES ("VENTANILLAS") DE LA BASE · MultiBar
-- ---------------------------------------------------------------------
-- Ejecutar después de datos/seguridad.sql. Se puede volver a ejecutar
-- entero cuando se cambie alguna función (todas son "create or replace").
--
-- CÓMO FUNCIONA (resumen para no programadores)
-- * Una sola base para todos los bares. Cada bar tiene su dirección
--   corta ("slug", p. ej. 'lamardegambas') que va en el enlace de la carta.
-- * La carta (cliente, sin login) dice siempre de qué bar es, y cada
--   ventanilla solo le enseña o le deja tocar lo de ese bar.
-- * El personal (camarero, barra, admin) es de UN bar: su sesión dice
--   cuál, y todas sus ventanillas se limitan a ese bar. Un camarero de un
--   bar no puede ver ni tocar nada de otro, aunque trucara la web.
-- * Lo demás no cambia: precio siempre de la base, código secreto de la
--   mesa, límites anti-spam, roles, limpieza automática (ver seguridad.sql).
-- =====================================================================

-- ---------------- AYUDANTES INTERNOS ----------------

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

-- Número de pedido de cada bar (el «Pedido nº N» del panel). Cada bar
-- lleva su propia cuenta; por defecto empieza en 1 cada día (según la hora
-- del bar, zona_horaria). Con ajustes.numeracion = 'continua' no se
-- reinicia nunca. Lo pone la base al crear el pedido (trigger), con un
-- cerrojo por bar para que dos pedidos a la vez no saquen el mismo número.
create or replace function privado.numerar_pedido()
returns trigger
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare v_zona text; v_continua boolean; v_dia date;
begin
  -- 2.ª parte de un pedido dividido (barra y cocina): mismo número que la 1.ª.
  if new.parte_de is not null then
    select numero into new.numero from orders where id = new.parte_de;
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('multibar.numero_pedido'), new.bar_id);
  select coalesce(zona_horaria, 'Europe/Madrid'),
         coalesce(ajustes->>'numeracion', 'diaria') = 'continua'
    into v_zona, v_continua
    from bares where id = new.bar_id;
  if v_continua then
    select coalesce(max(numero), 0) + 1 into new.numero from orders where bar_id = new.bar_id;
  else
    v_dia := (now() at time zone v_zona)::date;
    select coalesce(max(numero), 0) + 1 into new.numero from orders
     where bar_id = new.bar_id
       and created_at >= (v_dia::timestamp at time zone v_zona)
       and created_at <  ((v_dia + 1)::timestamp at time zone v_zona);
  end if;
  return new;
end $$;

drop trigger if exists orders_numero on multibar.orders;
create trigger orders_numero before insert on multibar.orders
  for each row execute function privado.numerar_pedido();

-- Un pedido con sus líneas, en el formato que usan la carta y el panel.
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
        from order_items i where i.order_id = o.id), '[]'::jsonb)
  )
  from orders o join mesas m on m.bar_id = o.bar_id and m.id = o.mesa_id
  where o.id = p_id
$$;

-- Comprueba las líneas que manda el cliente y las guarda con el precio
-- de la base. Solo valen productos del MISMO bar que el pedido.
-- p_previas: cantidades que ya tenía el pedido (al editar), para permitir
-- mantener un producto que se ha agotado mientras tanto.
create or replace function privado.guardar_lineas(p_pedido bigint, p_lineas jsonb, p_previas jsonb default '{}'::jsonb)
returns numeric
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare
  l jsonb; p products; v_cant int; v_nota text; v_total numeric := 0; v_bar int;
begin
  select bar_id into v_bar from orders where id = p_pedido;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'PEDIDO_VACIO';
  end if;
  if jsonb_array_length(p_lineas) > 30 then
    raise exception 'DEMASIADAS_LINEAS';
  end if;
  for l in select * from jsonb_array_elements(p_lineas) loop
    begin
      v_cant := (l->>'cantidad')::int;
    exception when others then
      raise exception 'CANTIDAD_NO_VALIDA';
    end;
    if v_cant is null or v_cant < 1 or v_cant > 20 then
      raise exception 'CANTIDAD_NO_VALIDA';
    end if;
    select * into p from products
     where id = (case when (l->>'producto') ~ '^[0-9]{1,9}$' then (l->>'producto')::int end)
       and bar_id = v_bar and visible;
    if not found then
      raise exception 'PRODUCTO_NO_VALIDO';
    end if;
    if not p.available and v_cant > coalesce((p_previas->>p.id::text)::int, 0) then
      raise exception 'AGOTADO:%', coalesce(p.name, '');
    end if;
    v_nota := left(btrim(regexp_replace(coalesce(l->>'nota', ''), '[[:cntrl:]]', ' ', 'g')), 140);
    insert into order_items (order_id, product_id, product_name, size, unit_price, quantity, note)
    values (p_pedido, p.id, p.name, p.size, p.price, v_cant, v_nota);
    v_total := v_total + p.price * v_cant;
  end loop;
  return v_total;
end $$;

-- Crea un pedido con sus líneas. Si el bar separa barra y cocina
-- (ajustes.barra_cocina), lo divide en dos partes según el destino de la
-- pestaña de cada producto: primero la de barra y luego la de cocina, con
-- el mismo número y la misma ronda; cada parte lleva su propio estado.
-- Devuelve la lista de partes (una sola si no se divide).
create or replace function privado.crear_partes(p_bar integer, p_mesa integer, p_ronda integer, p_dispositivo uuid, p_lineas jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare
  v_separa boolean; g record; v_id bigint; v_primera bigint; v_total numeric; v_res jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'PEDIDO_VACIO';
  end if;
  if jsonb_array_length(p_lineas) > 30 then
    raise exception 'DEMASIADAS_LINEAS';
  end if;
  select coalesce((ajustes->>'barra_cocina')::boolean, false) into v_separa from bares where id = p_bar;
  for g in
    select case when v_separa then coalesce(c.destino, 'cocina') end as destino,
           jsonb_agg(l.v order by l.n) as lineas
      from jsonb_array_elements(p_lineas) with ordinality as l(v, n)
      left join products pr on pr.bar_id = p_bar
            and pr.id = (case when (l.v->>'producto') ~ '^[0-9]{1,9}$' then (l.v->>'producto')::int end)
      left join categories c on c.bar_id = p_bar and c.id = pr.category_id
     group by 1
     order by 1 nulls first   -- 'barra' antes que 'cocina'
  loop
    insert into orders (bar_id, mesa_id, round_number, device_key, destino, parte_de)
    values (p_bar, p_mesa, p_ronda, p_dispositivo, g.destino, v_primera)
    returning id into v_id;
    v_primera := coalesce(v_primera, v_id);
    v_total := privado.guardar_lineas(v_id, g.lineas);
    update orders set total = v_total where id = v_id;
    v_res := v_res || jsonb_build_array(privado.pedido_json(v_id));
  end loop;
  return v_res;
end $$;

-- Pedidos NUEVOS que llevan 3 minutos sin que nadie los acepte pasan solos
-- a "en preparación" (con la marca auto_aceptado). Vale para todos los bares.
create or replace function privado.auto_aceptar()
returns void
language sql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
  update orders
     set status = 'en_preparacion', auto_aceptado = true, received_at = now(), received_by = null
   where status = 'enviado' and nuevo_desde < now() - interval '3 minutes';
$$;

-- Limpieza (todos los bares): pedidos de más de 30 días fuera; notas de
-- más de 24 h vacías; sesiones caducadas fuera.
create or replace function privado.limpiar()
returns void
language sql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
  delete from orders where created_at < now() - interval '30 days';
  update order_items set note = ''
   where note <> ''
     and order_id in (select id from orders where created_at < now() - interval '24 hours');
  delete from privado.sesiones where expires_at < now();
$$;

-- =====================================================================
-- VENTANILLAS DE LA CARTA (cliente de la mesa, sin login)
-- Todas reciben p_bar: el slug del bar que va en el enlace de la carta.
-- =====================================================================

-- Nombre, subtítulo y ajustes del bar (para pintar la cabecera, el pie…).
create or replace function public.carta_bar(p_bar text)
returns jsonb
language plpgsql stable security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare b bares;
begin
  b := privado.bar_de_slug(p_bar);
  return privado.bar_json(b.id);
end $$;

-- La carta: pestañas y productos visibles, con precio y si están agotados.
create or replace function public.carta_menu(p_bar text)
returns jsonb
language plpgsql stable security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare b bares;
begin
  b := privado.bar_de_slug(p_bar);
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'multi', c.multi, 'fam', c.fam, 'labs', to_jsonb(c.labs),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'dbId', p.id, 'n', p.name, 'dn', p.display_name, 'd', p.description,
        'p', p.price, 'size', p.size, 'only', p.only_size, 'sec', p.section,
        'pop', p.featured, 'al', to_jsonb(p.allergens), 'img', p.photo,
        'agotado', not p.available) order by p.sort_order, p.id)
      from products p where p.bar_id = c.bar_id and p.category_id = c.id and p.visible), '[]'::jsonb)
  ) order by c.sort_order), '[]'::jsonb)
  from categories c where c.bar_id = b.id);
end $$;

-- Nombre de la mesa si el bar, el número y el código del QR son correctos.
-- Con el "control de mesas" del bar encendido (ajustes.control_mesas), dice
-- además si el camarero ha abierto la mesa (solo entonces admite pedidos).
create or replace function public.carta_mesa(p_bar text, p_mesa integer, p_codigo text)
returns jsonb
language plpgsql stable security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare b bares;
begin
  b := privado.bar_de_slug(p_bar);
  return (select jsonb_build_object('id', m.id, 'nombre', m.name,
                   'control', coalesce((b.ajustes->>'control_mesas')::boolean, false),
                   'abierta', m.abierta_hasta is not null and m.abierta_hasta > now())
            from mesas m
           where m.bar_id = b.id and m.id = p_mesa and m.active and m.code = p_codigo);
end $$;

-- Crear un pedido.
create or replace function public.crear_pedido(p_bar text, p_mesa integer, p_codigo text, p_dispositivo uuid, p_lineas jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare
  b bares; v_partes jsonb; v_ronda int; v_hasta timestamptz;
begin
  b := privado.bar_de_slug(p_bar);
  if p_dispositivo is null then
    raise exception 'DISPOSITIVO_NO_VALIDO';
  end if;
  -- La mesa debe ser de este bar, estar activa y el código coincidir. Se
  -- bloquea la fila de la mesa para contar los pedidos sin carreras.
  select abierta_hasta into v_hasta from mesas
   where bar_id = b.id and id = p_mesa and active and code = p_codigo for update;
  if not found then
    raise exception 'MESA_NO_VALIDA';
  end if;
  -- Control de mesas: solo se pide si el camarero ha abierto la mesa.
  if coalesce((b.ajustes->>'control_mesas')::boolean, false)
     and (v_hasta is null or v_hasta <= now()) then
    raise exception 'MESA_CERRADA';
  end if;

  -- Límites anti-spam.
  if exists (select 1 from orders where device_key = p_dispositivo
              and created_at > now() - interval '20 seconds') then
    raise exception 'ESPERA_UN_MOMENTO';
  end if;
  -- (las 2.ª partes de un pedido dividido no cuentan como otro pedido)
  if (select count(*) from orders where device_key = p_dispositivo and parte_de is null
       and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'LIMITE_MOVIL';
  end if;
  if (select count(*) from orders where bar_id = b.id and mesa_id = p_mesa and parte_de is null
       and created_at > now() - interval '10 minutes') >= 6 then
    raise exception 'LIMITE_MESA';
  end if;

  perform privado.limpiar();

  select coalesce(max(round_number), 0) + 1 into v_ronda from orders
   where device_key = p_dispositivo and bar_id = b.id and mesa_id = p_mesa
     and created_at > now() - interval '12 hours';

  -- Devuelve la 1.ª parte (como siempre) y, en "partes", todas.
  v_partes := privado.crear_partes(b.id, p_mesa, v_ronda, p_dispositivo, p_lineas);
  return (v_partes->0) || jsonb_build_object('partes', v_partes);
end $$;

-- Editar (o anular, si se manda una lista vacía) un pedido propio
-- mientras siga "enviado" y no hayan pasado 3 minutos. El pedido ya dice
-- de qué bar es; solo lo puede tocar el móvil que lo hizo.
create or replace function public.editar_pedido(p_pedido bigint, p_dispositivo uuid, p_lineas jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare
  o orders; v_previas jsonb; v_total numeric;
begin
  select * into o from orders where id = p_pedido for update;
  if not found or o.device_key is distinct from p_dispositivo then
    raise exception 'PEDIDO_NO_ENCONTRADO';
  end if;
  if o.status <> 'enviado' or o.created_at < now() - interval '3 minutes' then
    raise exception 'YA_NO_EDITABLE';
  end if;

  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    delete from orders where id = o.id;
    return jsonb_build_object('id', o.id, 'anulado', true);
  end if;

  select coalesce(jsonb_object_agg(product_id::text, cant), '{}'::jsonb) into v_previas
    from (select product_id, sum(quantity) cant from order_items
           where order_id = o.id group by product_id) t;
  delete from order_items where order_id = o.id;
  v_total := privado.guardar_lineas(o.id, p_lineas, v_previas);
  update orders set total = v_total, modified_at = now() where id = o.id;
  return privado.pedido_json(o.id);
end $$;

-- Los pedidos de este móvil en este bar en las últimas 12 horas (para el tique).
create or replace function public.mis_pedidos(p_bar text, p_dispositivo uuid)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare b bares;
begin
  b := privado.bar_de_slug(p_bar);
  perform privado.auto_aceptar();
  return (select coalesce(jsonb_agg(privado.pedido_json(o.id) order by o.created_at), '[]'::jsonb)
            from orders o
           where o.bar_id = b.id
             and o.device_key = p_dispositivo
             and o.created_at > now() - interval '12 hours');
end $$;

-- =====================================================================
-- LOGIN DEL PERSONAL
-- =====================================================================

-- Entrar con correo y contraseña. Devuelve el token de la sesión y el bar
-- del usuario, o {"error": "CREDENCIALES"} (sin lanzar error, para que se
-- guarde el contador de intentos fallidos).
create or replace function public.personal_entrar(p_email text, p_password text)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare
  s staff; v_token text;
begin
  select * into s from staff where lower(email) = lower(btrim(coalesce(p_email, ''))) for update;
  if not found then
    -- Mismo trabajo que con un usuario real, para no revelar qué correos existen.
    perform privado.crypt(coalesce(p_password, ''), privado.gen_salt('bf', 10));
    return jsonb_build_object('error', 'CREDENCIALES');
  end if;
  if s.locked_until is not null and s.locked_until > now() then
    raise exception 'BLOQUEADO';
  end if;
  if not s.active or s.password_hash <> privado.crypt(coalesce(p_password, ''), s.password_hash) then
    update staff
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' end
     where id = s.id;
    return jsonb_build_object('error', 'CREDENCIALES');
  end if;
  -- Contraseña buena, pero su bar está dado de baja.
  if not exists (select 1 from bares where id = s.bar_id and activo) then
    raise exception 'BAR_NO_VALIDO';
  end if;

  update staff set failed_attempts = 0, locked_until = null where id = s.id;
  delete from privado.sesiones where expires_at < now();
  v_token := encode(privado.gen_random_bytes(32), 'hex');
  insert into privado.sesiones (token_hash, staff_id, expires_at)
  values (privado.digest(v_token, 'sha256'), s.id, now() + interval '16 hours');

  return jsonb_build_object('token', v_token, 'nombre', s.name, 'rol', s.role,
                            'email', s.email, 'cambiar_password', s.must_change_password,
                            'bar', privado.bar_json(s.bar_id));
end $$;

-- Quién soy y de qué bar (para comprobar al abrir el panel que la sesión
-- sigue viva).
create or replace function public.personal_yo(p_token text)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s staff;
begin
  s := privado.staff_de_token(p_token);
  return jsonb_build_object('nombre', s.name, 'rol', s.role, 'email', s.email,
                            'cambiar_password', s.must_change_password,
                            'bar', privado.bar_json(s.bar_id));
end $$;

-- Salir (borra la sesión de este dispositivo).
create or replace function public.personal_salir(p_token text)
returns void
language sql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
  delete from privado.sesiones where token_hash = privado.digest(coalesce(p_token, ''), 'sha256');
$$;

-- Cambiar la contraseña propia (obligatorio la primera vez).
create or replace function public.personal_cambiar_password(p_token text, p_actual text, p_nueva text)
returns void
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s staff;
begin
  s := privado.staff_de_token(p_token);
  if s.password_hash <> privado.crypt(coalesce(p_actual, ''), s.password_hash) then
    raise exception 'CREDENCIALES';
  end if;
  if length(coalesce(p_nueva, '')) < 8 then
    raise exception 'PASSWORD_CORTA';
  end if;
  update staff set password_hash = privado.crypt(p_nueva, privado.gen_salt('bf', 10)),
                   must_change_password = false
   where id = s.id;
  -- Cierra las demás sesiones abiertas de este usuario.
  delete from privado.sesiones
   where staff_id = s.id and token_hash <> privado.digest(p_token, 'sha256');
end $$;

-- =====================================================================
-- VENTANILLAS DEL PANEL (camarero, barra y admin)
-- Todas trabajan SOLO con el bar del usuario de la sesión (s.bar_id).
-- =====================================================================

-- Pedidos del día (desde las 00:00 en la hora del bar, o las últimas 12
-- horas si eso es más; o desde una hora dada). Antes, pasa solos a "en
-- preparación" los nuevos que llevan 3 minutos sin aceptar.
create or replace function public.panel_pedidos(p_token text, p_desde timestamptz default null)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s staff; v_desde timestamptz; v_zona text;
begin
  s := privado.exigir_rol(p_token, array['camarero','barra','admin']);
  perform privado.auto_aceptar();
  select zona_horaria into v_zona from bares where id = s.bar_id;
  v_desde := least(date_trunc('day', now() at time zone v_zona) at time zone v_zona,
                   now() - interval '12 hours');
  return (select coalesce(jsonb_agg(privado.pedido_json(o.id) order by o.created_at), '[]'::jsonb)
            from orders o
           where o.bar_id = s.bar_id
             and o.created_at > greatest(coalesce(p_desde, '-infinity'), v_desde));
end $$;

-- Cambiar el estado: Aceptar (en preparación), Servido o Deshacer (un paso
-- atrás). Si se deshace a NUEVO, vuelve a contar 3 minutos.
create or replace function public.panel_marcar(p_token text, p_pedido bigint, p_estado text)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s staff; o orders;
begin
  s := privado.exigir_rol(p_token, array['camarero','barra','admin']);
  select * into o from orders where id = p_pedido and bar_id = s.bar_id for update;
  if not found then
    raise exception 'PEDIDO_NO_ENCONTRADO';
  end if;
  if p_estado = o.status then
    return privado.pedido_json(o.id);
  end if;
  -- Un pedido ya cobrado no vuelve atrás (primero hay que reabrir su cuenta).
  if o.cobrado_at is not null then
    raise exception 'YA_COBRADO';
  end if;
  if (o.status, p_estado) in (('enviado','en_preparacion'), ('enviado','servido')) then
    update orders set status = p_estado, auto_aceptado = false,
           received_at = coalesce(received_at, now()), received_by = coalesce(received_by, s.name),
           served_at = case when p_estado = 'servido' then now() end,
           served_by = case when p_estado = 'servido' then s.name end
     where id = o.id;
  elsif (o.status, p_estado) = ('en_preparacion','servido') then
    update orders set status = 'servido', served_at = now(), served_by = s.name where id = o.id;
  elsif (o.status, p_estado) = ('servido','en_preparacion') then
    update orders set status = 'en_preparacion', served_at = null, served_by = null where id = o.id;
  elsif (o.status, p_estado) = ('en_preparacion','enviado') then
    update orders set status = 'enviado', auto_aceptado = false, nuevo_desde = now(),
           received_at = null, received_by = null where id = o.id;
  else
    raise exception 'CAMBIO_NO_VALIDO';
  end if;
  return privado.pedido_json(o.id);
end $$;

-- Crear un pedido desde el panel (camarero, barra y admin) para una mesa
-- de su bar. No necesita el código del QR ni tiene límite anti-spam. Entra
-- como NUEVO, igual que los pedidos de los clientes. Precio de la base y
-- sin agotados (lo comprueba privado.guardar_lineas).
create or replace function public.panel_crear_pedido(p_token text, p_mesa integer, p_lineas jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s staff; v_partes jsonb;
begin
  s := privado.exigir_rol(p_token, array['camarero','barra','admin']);
  perform 1 from mesas where bar_id = s.bar_id and id = p_mesa;
  if not found then
    raise exception 'MESA_NO_VALIDA';
  end if;
  -- Igual que en la carta: con «barra y cocina» se divide en dos partes.
  v_partes := privado.crear_partes(s.bar_id, p_mesa, 1, gen_random_uuid(), p_lineas);
  return (v_partes->0) || jsonb_build_object('partes', v_partes);
end $$;

-- Mesas para elegir al crear un pedido desde el panel (sin códigos del QR).
create or replace function public.panel_mesas(p_token text)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s staff;
begin
  s := privado.exigir_rol(p_token, array['camarero','barra','admin']);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', name, 'activa', active,
                   'abierta_hasta', case when abierta_hasta > now() then abierta_hasta end) order by id), '[]'::jsonb)
            from mesas where bar_id = s.bar_id);
end $$;

-- Control de mesas: abrir (admite pedidos durante las horas de
-- ajustes.horas_mesa, 4 por defecto) o cerrar una mesa de su bar.
create or replace function public.panel_abrir_mesa(p_token text, p_mesa integer, p_abrir boolean)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s staff; v_horas int; r jsonb;
begin
  s := privado.exigir_rol(p_token, array['camarero','barra','admin']);
  select coalesce((ajustes->>'horas_mesa')::int, 4) into v_horas from bares where id = s.bar_id;
  update mesas
     set abierta_hasta = case when p_abrir then now() + make_interval(hours => least(greatest(v_horas, 1), 24)) end
   where bar_id = s.bar_id and id = p_mesa
  returning jsonb_build_object('id', id, 'nombre', name, 'activa', active,
            'abierta_hasta', case when abierta_hasta > now() then abierta_hasta end) into r;
  if r is null then
    raise exception 'MESA_NO_VALIDA';
  end if;
  return r;
end $$;

-- Modificar un pedido desde el panel (camarero, barra y admin), en
-- cualquier estado, también servido (p. ej. la mesa ya no quiere algo).
-- p_cambios = {"lineas": [{"id": 12, "cantidad": 0}, ...],
--              "nuevas": [{"producto": 35, "cantidad": 1, "nota": ""}, ...]}
-- Una línea a 0 no se borra: queda en el pedido en gris y a cero euros.
-- Los productos nuevos van al precio de la base, tienen que ser del mismo
-- bar y no pueden estar agotados.
create or replace function public.panel_modificar_pedido(p_token text, p_pedido bigint, p_cambios jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare
  s staff; o orders; l jsonb; p products; v_cant int; v_nota text;
  d jsonb := coalesce(p_cambios, '{}'::jsonb);
begin
  s := privado.exigir_rol(p_token, array['camarero','barra','admin']);
  select * into o from orders where id = p_pedido and bar_id = s.bar_id for update;
  if not found then
    raise exception 'PEDIDO_NO_ENCONTRADO';
  end if;
  -- Un pedido ya cobrado no se cambia (primero hay que reabrir su cuenta).
  if o.cobrado_at is not null then
    raise exception 'YA_COBRADO';
  end if;

  -- Cambiar cantidades de líneas que ya están en el pedido.
  for l in select * from jsonb_array_elements(coalesce(d->'lineas', '[]'::jsonb)) loop
    begin
      v_cant := (l->>'cantidad')::int;
    exception when others then
      raise exception 'CANTIDAD_NO_VALIDA';
    end;
    if v_cant is null or v_cant < 0 or v_cant > 20 then
      raise exception 'CANTIDAD_NO_VALIDA';
    end if;
    update order_items set quantity = v_cant
     where id = (case when (l->>'id') ~ '^[0-9]{1,18}$' then (l->>'id')::bigint end)
       and order_id = o.id;
    if not found then
      raise exception 'LINEA_NO_VALIDA';
    end if;
  end loop;

  -- Añadir productos nuevos.
  for l in select * from jsonb_array_elements(coalesce(d->'nuevas', '[]'::jsonb)) loop
    begin
      v_cant := (l->>'cantidad')::int;
    exception when others then
      raise exception 'CANTIDAD_NO_VALIDA';
    end;
    if v_cant is null or v_cant < 1 or v_cant > 20 then
      raise exception 'CANTIDAD_NO_VALIDA';
    end if;
    select * into p from products
     where id = (case when (l->>'producto') ~ '^[0-9]{1,9}$' then (l->>'producto')::int end)
       and bar_id = s.bar_id and visible;
    if not found then
      raise exception 'PRODUCTO_NO_VALIDO';
    end if;
    if not p.available then
      raise exception 'AGOTADO:%', coalesce(p.name, '');
    end if;
    v_nota := left(btrim(regexp_replace(coalesce(l->>'nota', ''), '[[:cntrl:]]', ' ', 'g')), 140);
    insert into order_items (order_id, product_id, product_name, size, unit_price, quantity, note)
    values (o.id, p.id, p.name, p.size, p.price, v_cant, v_nota);
  end loop;

  if (select count(*) from order_items where order_id = o.id) > 40 then
    raise exception 'DEMASIADAS_LINEAS';
  end if;

  update orders
     set total = (select coalesce(sum(unit_price * quantity), 0) from order_items where order_id = o.id)
   where id = o.id;
  return privado.pedido_json(o.id);
end $$;

-- Lista completa de productos de su bar (con los ocultos) para barra y admin.
create or replace function public.panel_productos(p_token text)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s staff;
begin
  s := privado.exigir_rol(p_token, array['barra','admin']);
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', p.id, 'categoria', p.category_id, 'nombre', p.name, 'nombre_corto', p.display_name,
            'descripcion', p.description, 'tamano', p.size, 'solo_tamano', p.only_size,
            'seccion', p.section, 'precio', p.price, 'disponible', p.available,
            'visible', p.visible, 'destacado', p.featured, 'orden', p.sort_order,
            'actualizado', p.updated_at, 'actualizado_por', p.updated_by)
            order by c.sort_order, p.sort_order, p.id), '[]'::jsonb)
            from products p join categories c on c.bar_id = p.bar_id and c.id = p.category_id
           where p.bar_id = s.bar_id);
end $$;

-- Marcar un producto de su bar como agotado o disponible (barra y admin).
create or replace function public.panel_disponible(p_token text, p_producto integer, p_disponible boolean)
returns void
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s staff;
begin
  s := privado.exigir_rol(p_token, array['barra','admin']);
  update products set available = coalesce(p_disponible, true), updated_at = now(), updated_by = s.name
   where id = p_producto and bar_id = s.bar_id;
  if not found then
    raise exception 'PRODUCTO_NO_VALIDO';
  end if;
end $$;

-- =====================================================================
-- VENTANILLAS DEL ADMINISTRADOR (de su bar)
-- =====================================================================

-- Crear (sin "id") o cambiar (con "id") un producto de su bar: precio,
-- nombre, visible, etc. Los productos no se borran: se ocultan
-- (visible = false), para no romper pedidos antiguos.
create or replace function public.admin_guardar_producto(p_token text, p_datos jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s staff; v_id int; d jsonb := coalesce(p_datos, '{}'::jsonb);
begin
  s := privado.exigir_rol(p_token, array['admin']);
  -- La pestaña tiene que ser de su bar.
  if d->>'categoria' is not null
     and not exists (select 1 from categories where bar_id = s.bar_id and id = d->>'categoria') then
    raise exception 'FALTAN_DATOS';
  end if;
  if d ? 'id' and d->>'id' is not null then
    update products set
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
      updated_at   = now(), updated_by = s.name
    where id = (d->>'id')::int and bar_id = s.bar_id
    returning id into v_id;
    if v_id is null then
      raise exception 'PRODUCTO_NO_VALIDO';
    end if;
  else
    if nullif(btrim(d->>'nombre'), '') is null or d->>'categoria' is null or d->>'precio' is null then
      raise exception 'FALTAN_DATOS';
    end if;
    insert into products (bar_id, category_id, name, display_name, description, size, only_size, section,
                          price, available, visible, featured, sort_order, updated_by)
    values (s.bar_id, d->>'categoria', btrim(d->>'nombre'), nullif(btrim(d->>'nombre_corto'), ''),
            coalesce(d->>'descripcion', ''), nullif(d->>'tamano', ''),
            coalesce((d->>'solo_tamano')::boolean, false), coalesce(d->>'seccion', ''),
            (d->>'precio')::numeric, coalesce((d->>'disponible')::boolean, true),
            coalesce((d->>'visible')::boolean, true), coalesce((d->>'destacado')::boolean, false),
            coalesce((d->>'orden')::int, (select coalesce(max(sort_order), 0) + 1 from products where bar_id = s.bar_id)),
            s.name)
    returning id into v_id;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

-- Lista de usuarios del personal de su bar (sin contraseñas).
create or replace function public.admin_usuarios(p_token text)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s staff;
begin
  s := privado.exigir_rol(p_token, array['admin']);
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', id, 'email', email, 'nombre', name, 'rol', role, 'activo', active,
            'cambiar_password', must_change_password,
            'bloqueado', locked_until is not null and locked_until > now()) order by name), '[]'::jsonb)
            from staff where bar_id = s.bar_id);
end $$;

-- Crear (sin "id") o cambiar (con "id") un usuario de su bar. Si se manda
-- "password", queda como contraseña provisional y el usuario tendrá que
-- cambiarla al entrar. Nunca puede quedarse el bar sin admin activo.
create or replace function public.admin_guardar_usuario(p_token text, p_datos jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s staff; v_id int; d jsonb := coalesce(p_datos, '{}'::jsonb); v_pass text; v_email text;
begin
  s := privado.exigir_rol(p_token, array['admin']);
  v_pass := nullif(d->>'password', '');
  v_email := nullif(btrim(d->>'email'), '');
  if v_pass is not null and length(v_pass) < 8 then
    raise exception 'PASSWORD_CORTA';
  end if;
  if d->>'rol' is not null and d->>'rol' not in ('camarero','barra','admin') then
    raise exception 'ROL_NO_VALIDO';
  end if;
  -- El correo es único en toda la plataforma (sin decir de qué bar es el otro).
  if v_email is not null and exists (
       select 1 from staff where lower(email) = lower(v_email)
          and id is distinct from (case when d->>'id' ~ '^[0-9]{1,9}$' then (d->>'id')::int end)) then
    raise exception 'EMAIL_EN_USO';
  end if;

  if d ? 'id' and d->>'id' is not null then
    update staff set
      email  = coalesce(v_email, email),
      name   = coalesce(nullif(btrim(d->>'nombre'), ''), name),
      role   = coalesce(d->>'rol', role),
      active = coalesce((d->>'activo')::boolean, active),
      password_hash = case when v_pass is not null then privado.crypt(v_pass, privado.gen_salt('bf', 10)) else password_hash end,
      must_change_password = case when v_pass is not null then true else must_change_password end,
      failed_attempts = case when v_pass is not null then 0 else failed_attempts end,
      locked_until    = case when v_pass is not null then null else locked_until end
    where id = (d->>'id')::int and bar_id = s.bar_id
    returning id into v_id;
    if v_id is null then
      raise exception 'USUARIO_NO_VALIDO';
    end if;
    -- Si se desactiva o se le cambia la contraseña, se cierran sus sesiones.
    if v_pass is not null or (d->>'activo')::boolean is false then
      delete from privado.sesiones where staff_id = v_id;
    end if;
  else
    if v_email is null or nullif(btrim(d->>'nombre'), '') is null
       or d->>'rol' is null or v_pass is null then
      raise exception 'FALTAN_DATOS';
    end if;
    insert into staff (bar_id, email, name, role, password_hash)
    values (s.bar_id, v_email, btrim(d->>'nombre'), d->>'rol', privado.crypt(v_pass, privado.gen_salt('bf', 10)))
    returning id into v_id;
  end if;

  if not exists (select 1 from staff where bar_id = s.bar_id and role = 'admin' and active) then
    raise exception 'ULTIMO_ADMIN';
  end if;
  return jsonb_build_object('id', v_id);
end $$;

-- Mesas de su bar con su código secreto (para imprimir los QR).
create or replace function public.admin_mesas(p_token text)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s staff;
begin
  s := privado.exigir_rol(p_token, array['admin']);
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', id, 'nombre', name, 'activa', active, 'codigo', code) order by id), '[]'::jsonb)
            from mesas where bar_id = s.bar_id);
end $$;

-- Crear o cambiar una mesa de su bar. "nuevo_codigo": true genera otro
-- código (habrá que reimprimir su QR).
create or replace function public.admin_guardar_mesa(p_token text, p_datos jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s staff; d jsonb := coalesce(p_datos, '{}'::jsonb); v_id int;
begin
  s := privado.exigir_rol(p_token, array['admin']);
  v_id := case when d->>'id' ~ '^[0-9]{1,3}$' then (d->>'id')::int end;
  if v_id is null or v_id < 1 then
    raise exception 'FALTAN_DATOS';
  end if;
  insert into mesas (bar_id, id, name, active)
  values (s.bar_id, v_id, coalesce(nullif(btrim(d->>'nombre'), ''), 'Mesa ' || v_id), coalesce((d->>'activa')::boolean, true))
  on conflict (bar_id, id) do update set
    name   = coalesce(nullif(btrim(d->>'nombre'), ''), mesas.name),
    active = coalesce((d->>'activa')::boolean, mesas.active),
    code   = case when (d->>'nuevo_codigo')::boolean
                  then substr(replace(gen_random_uuid()::text, '-', ''), 1, 8) else mesas.code end;
  return (select jsonb_build_object('id', id, 'nombre', name, 'activa', active, 'codigo', code)
            from mesas where bar_id = s.bar_id and id = v_id);
end $$;

-- =====================================================================
-- AVISOS DE LA MESA Y CUENTAS (v15)
-- =====================================================================

-- «Llamar al camarero» (tipo 'camarero') o «Pedir la cuenta» ('cuenta')
-- desde la carta, con el QR de la mesa. Solo si el bar tiene la opción
-- ajustes.avisos_mesa. Si ya hay un aviso igual sin atender, no se repite.
-- Como mucho un aviso cada 30 s y 20 a la hora por mesa.
create or replace function public.carta_aviso(p_bar text, p_mesa integer, p_codigo text, p_tipo text)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare b bares; v_hasta timestamptz;
begin
  b := privado.bar_de_slug(p_bar);
  if not coalesce((b.ajustes->>'avisos_mesa')::boolean, false) then
    raise exception 'FUNCION_NO_ACTIVA';
  end if;
  if p_tipo not in ('camarero', 'cuenta') then
    raise exception 'FALTAN_DATOS';
  end if;
  select abierta_hasta into v_hasta from mesas
   where bar_id = b.id and id = p_mesa and active and code = p_codigo for update;
  if not found then
    raise exception 'MESA_NO_VALIDA';
  end if;
  if coalesce((b.ajustes->>'control_mesas')::boolean, false)
     and (v_hasta is null or v_hasta <= now()) then
    raise exception 'MESA_CERRADA';
  end if;
  -- «Pedir la cuenta» solo si la mesa tiene pedidos de hoy sin cobrar (v17).
  if p_tipo = 'cuenta' and not exists (select 1 from orders where bar_id = b.id and mesa_id = p_mesa
              and cobrado_at is null and created_at > privado.desde_hoy(b.id)) then
    raise exception 'SIN_PEDIDOS';
  end if;
  if exists (select 1 from avisos where bar_id = b.id and mesa_id = p_mesa
              and tipo = p_tipo and atendido_at is null) then
    return jsonb_build_object('ok', true, 'repetido', true);
  end if;
  if exists (select 1 from avisos where bar_id = b.id and mesa_id = p_mesa
              and created_at > now() - interval '30 seconds')
     or (select count(*) from avisos where bar_id = b.id and mesa_id = p_mesa
          and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'ESPERA_UN_MOMENTO';
  end if;
  insert into avisos (bar_id, mesa_id, tipo) values (b.id, p_mesa, p_tipo);
  return jsonb_build_object('ok', true);
end $$;

-- Avisos sin atender del bar (para el panel).
create or replace function privado.avisos_json(p_bar integer)
returns jsonb
language sql stable security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'mesa', a.mesa_id, 'mesa_nombre', m.name,
                    'tipo', a.tipo, 'creado', a.created_at) order by a.created_at), '[]'::jsonb)
    from avisos a join mesas m on m.bar_id = a.bar_id and m.id = a.mesa_id
   where a.bar_id = p_bar and a.atendido_at is null
     and a.created_at > now() - interval '12 hours'
$$;

-- Lo que el panel pregunta cada pocos segundos: pedidos del día y avisos
-- de las mesas sin atender.
create or replace function public.panel_estado(p_token text, p_desde timestamptz default null)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s staff;
begin
  s := privado.exigir_rol(p_token, array['camarero','barra','admin']);
  return jsonb_build_object('pedidos', public.panel_pedidos(p_token, p_desde),
                            'avisos', privado.avisos_json(s.bar_id));
end $$;

-- Marcar un aviso como atendido.
create or replace function public.panel_atender_aviso(p_token text, p_aviso bigint)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s staff;
begin
  s := privado.exigir_rol(p_token, array['camarero','barra','admin']);
  update avisos set atendido_at = now(), atendido_por = s.name
   where id = p_aviso and bar_id = s.bar_id and atendido_at is null;
  return privado.avisos_json(s.bar_id);
end $$;

-- Desde cuándo cuentan las cuentas de hoy (00:00 en la hora del bar, o
-- las últimas 12 horas si eso es más), igual que los pedidos del panel.
create or replace function privado.desde_hoy(p_bar integer)
returns timestamptz
language sql stable security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
  select least(date_trunc('day', now() at time zone zona_horaria) at time zone zona_horaria,
               now() - interval '12 hours')
    from bares where id = p_bar
$$;

-- Líneas de unos pedidos, juntando las del mismo producto y precio.
create or replace function privado.lineas_juntas(p_pedidos bigint[])
returns jsonb
language sql stable security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object('nombre', x.nombre, 'cantidad', x.cant,
                    'precio', x.precio, 'importe', x.importe) order by x.primera), '[]'::jsonb)
    from (select i.product_name as nombre, i.unit_price as precio, sum(i.quantity) as cant,
                 sum(i.quantity * i.unit_price) as importe, min(i.id) as primera
            from order_items i
           where i.order_id = any(p_pedidos) and i.quantity > 0
           group by i.product_name, i.unit_price) x
$$;

-- Cuentas de las mesas: lo pedido hoy y sin cobrar, mesa por mesa, con
-- todos los pedidos juntos (de todos los móviles, de barra y de cocina).
-- Solo se cobra lo SERVIDO: "total" y "lineas" son lo servido (con "ids",
-- los pedidos que se cobrarán); lo que aún no se ha servido va aparte en
-- "pendiente" y "lineas_pendientes" y no se cobra todavía.
create or replace function public.panel_cuentas(p_token text)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s staff; v_desde timestamptz;
begin
  s := privado.exigir_rol(p_token, array['camarero','barra','admin']);
  v_desde := privado.desde_hoy(s.bar_id);
  return (select coalesce(jsonb_agg(c order by c->>'desde'), '[]'::jsonb) from (
    select jsonb_build_object(
      'mesa', t.mesa_id, 'mesa_nombre', t.nombre,
      'total', t.total, 'pendiente', t.pendiente,
      'pedidos', t.pedidos, 'sin_servir', t.sin_servir, 'desde', t.desde,
      'ids', to_jsonb(t.servidos),
      'lineas', privado.lineas_juntas(t.servidos),
      'lineas_pendientes', privado.lineas_juntas(t.no_servidos)) as c
      from (select o.mesa_id, min(m.name) as nombre, min(o.created_at) as desde,
                   coalesce(sum(o.total) filter (where o.status = 'servido'), 0) as total,
                   coalesce(sum(o.total) filter (where o.status <> 'servido'), 0) as pendiente,
                   count(distinct coalesce(o.parte_de, o.id)) as pedidos,
                   count(*) filter (where o.status <> 'servido') as sin_servir,
                   coalesce(array_agg(o.id order by o.id) filter (where o.status = 'servido'), '{}') as servidos,
                   coalesce(array_agg(o.id order by o.id) filter (where o.status <> 'servido'), '{}') as no_servidos
              from orders o join mesas m on m.bar_id = o.bar_id and m.id = o.mesa_id
             where o.bar_id = s.bar_id and o.cobrado_at is null and o.created_at > v_desde
             group by o.mesa_id) t) u);
end $$;

-- Cobrar la cuenta de una mesa: SOLO los pedidos que el camarero tenía en
-- pantalla (p_pedidos), que sigan servidos y sin cobrar. Así no se cobra
-- nada sin servir ni un pedido que acaba de llegar. Atiende los avisos de
-- la mesa. Todos quedan con la misma hora de cobro (para poder reabrir).
-- p_pedidos: lista JSON de ids, p. ej. [71, 72].
create or replace function public.panel_cobrar(p_token text, p_mesa integer, p_pedidos jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s staff; v_n int; v_total numeric; v_ids bigint[];
begin
  s := privado.exigir_rol(p_token, array['camarero','barra','admin']);
  select coalesce(array_agg(x::bigint), '{}') into v_ids
    from jsonb_array_elements_text(case when jsonb_typeof(p_pedidos) = 'array' then p_pedidos else '[]'::jsonb end) x
   where x ~ '^[0-9]{1,18}$';
  update orders set cobrado_at = now(), cobrado_por = s.name
   where bar_id = s.bar_id and mesa_id = p_mesa and id = any(v_ids)
     and status = 'servido' and cobrado_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'NADA_QUE_COBRAR';
  end if;
  select sum(total) into v_total from orders
   where bar_id = s.bar_id and mesa_id = p_mesa and cobrado_at = now();
  update avisos set atendido_at = now(), atendido_por = s.name
   where bar_id = s.bar_id and mesa_id = p_mesa and atendido_at is null;
  return jsonb_build_object('cobrados', v_n, 'total', v_total);
end $$;

-- Versión anterior (panel v15): ahora también cobra solo lo servido.
create or replace function public.panel_cobrar_mesa(p_token text, p_mesa integer)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s staff;
begin
  s := privado.exigir_rol(p_token, array['camarero','barra','admin']);
  return public.panel_cobrar(p_token, p_mesa, (select coalesce(jsonb_agg(id), '[]'::jsonb) from orders
           where bar_id = s.bar_id and mesa_id = p_mesa and cobrado_at is null
             and status = 'servido' and created_at > privado.desde_hoy(s.bar_id)));
end $$;

-- Cuentas cobradas hoy (las últimas primero), para poder reabrir una por error.
create or replace function public.panel_cobradas(p_token text)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s staff;
begin
  s := privado.exigir_rol(p_token, array['camarero','barra','admin']);
  return (select coalesce(jsonb_agg(jsonb_build_object('mesa', t.mesa_id, 'mesa_nombre', t.nombre,
                    'cuando', t.cobrado_at, 'por', t.por, 'total', t.total, 'pedidos', t.pedidos)
                    order by t.cobrado_at desc), '[]'::jsonb)
            from (select o.mesa_id, o.cobrado_at, min(m.name) as nombre, min(o.cobrado_por) as por,
                         sum(o.total) as total, count(distinct coalesce(o.parte_de, o.id)) as pedidos
                    from orders o join mesas m on m.bar_id = o.bar_id and m.id = o.mesa_id
                   where o.bar_id = s.bar_id and o.cobrado_at > privado.desde_hoy(s.bar_id)
                   group by o.mesa_id, o.cobrado_at) t);
end $$;

-- Reabrir una cuenta cobrada por error: sus pedidos vuelven a estar sin cobrar.
create or replace function public.panel_reabrir_cuenta(p_token text, p_mesa integer, p_cuando timestamptz)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s staff; v_n int;
begin
  s := privado.exigir_rol(p_token, array['camarero','barra','admin']);
  update orders set cobrado_at = null, cobrado_por = null
   where bar_id = s.bar_id and mesa_id = p_mesa and cobrado_at = p_cuando;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'PEDIDO_NO_ENCONTRADO';
  end if;
  return jsonb_build_object('reabiertos', v_n);
end $$;

-- =====================================================================
-- RECUPERAR LA CONTRASEÑA POR CORREO (v18)
-- La pide el propio usuario en la entrada del panel. La Edge Function
-- «recuperar-contrasena» (servidor de Supabase, con la clave secreta que
-- solo vive allí) llama a recuperar_crear y manda el correo con Resend.
-- La web nunca sabe si un correo existe: siempre contesta lo mismo.
-- =====================================================================

-- Crea un enlace de recuperación para ese correo (o null si no es de un
-- usuario activo de un bar activo, o si ya pidió 3 en la última hora).
-- Anula los enlaces anteriores sin usar. SOLO para el servidor (service_role).
create or replace function public.recuperar_crear(p_email text)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s staff; b bares; v_token text;
begin
  select * into s from staff where lower(email) = lower(btrim(coalesce(p_email, ''))) and active;
  if not found then
    return null;
  end if;
  select * into b from bares where id = s.bar_id and activo;
  if not found then
    return null;
  end if;
  if (select count(*) from privado.recuperaciones
       where staff_id = s.id and created_at > now() - interval '1 hour') >= 3 then
    return null;
  end if;
  update privado.recuperaciones set usado_at = now() where staff_id = s.id and usado_at is null;
  v_token := encode(privado.gen_random_bytes(32), 'hex');
  insert into privado.recuperaciones (token_hash, staff_id, expires_at)
  values (privado.digest(v_token, 'sha256'), s.id, now() + interval '30 minutes');
  return jsonb_build_object('token', v_token, 'email', s.email, 'nombre', s.name,
                            'bar_nombre', b.nombre, 'bar_slug', b.slug);
end $$;

-- Poner una contraseña nueva con el enlace del correo. Cierra las
-- sesiones abiertas de ese usuario y le quita el bloqueo por fallos.
create or replace function public.personal_restablecer(p_token text, p_nueva text)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare r privado.recuperaciones; v_email text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'ENLACE_NO_VALIDO';
  end if;
  select * into r from privado.recuperaciones
   where token_hash = privado.digest(p_token, 'sha256') for update;
  if not found or r.usado_at is not null or r.expires_at < now() then
    raise exception 'ENLACE_NO_VALIDO';
  end if;
  if length(coalesce(p_nueva, '')) < 8 then
    raise exception 'PASSWORD_CORTA';
  end if;
  update staff set password_hash = privado.crypt(p_nueva, privado.gen_salt('bf', 10)),
                   must_change_password = false, failed_attempts = 0, locked_until = null
   where id = r.staff_id and active
  returning email into v_email;
  if v_email is null then
    raise exception 'ENLACE_NO_VALIDO';
  end if;
  update privado.recuperaciones set usado_at = now() where token_hash = r.token_hash;
  update privado.sesiones set expires_at = now() where staff_id = r.staff_id and expires_at > now();
  return jsonb_build_object('email', v_email);
end $$;

-- =====================================================================
-- PERMISOS: la web solo puede usar estas ventanillas
-- =====================================================================
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema privado from public, anon, authenticated;

-- Cliente de la mesa y personal (la web siempre entra como "anon", el
-- visitante de Supabase; quién es el personal lo dice su token de sesión).
grant execute on function
  public.carta_bar(text),
  public.carta_menu(text),
  public.carta_mesa(text, integer, text),
  public.crear_pedido(text, integer, text, uuid, jsonb),
  public.editar_pedido(bigint, uuid, jsonb),
  public.mis_pedidos(text, uuid),
  public.personal_entrar(text, text),
  public.personal_yo(text),
  public.personal_salir(text),
  public.personal_cambiar_password(text, text, text),
  public.panel_pedidos(text, timestamptz),
  public.panel_marcar(text, bigint, text),
  public.panel_modificar_pedido(text, bigint, jsonb),
  public.panel_crear_pedido(text, integer, jsonb),
  public.panel_mesas(text),
  public.panel_abrir_mesa(text, integer, boolean),
  public.panel_productos(text),
  public.panel_disponible(text, integer, boolean),
  public.admin_guardar_producto(text, jsonb),
  public.admin_usuarios(text),
  public.admin_guardar_usuario(text, jsonb),
  public.admin_mesas(text),
  public.admin_guardar_mesa(text, jsonb),
  public.carta_aviso(text, integer, text, text),
  public.panel_estado(text, timestamptz),
  public.panel_atender_aviso(text, bigint),
  public.panel_cuentas(text),
  public.panel_cobrar_mesa(text, integer),
  public.panel_cobrar(text, integer, jsonb),
  public.panel_cobradas(text),
  public.panel_reabrir_cuenta(text, integer, timestamptz),
  public.personal_restablecer(text, text)
to anon, authenticated;

-- Solo el servidor de Supabase (Edge Function con la clave secreta) puede
-- crear enlaces de recuperación. Fuera de Supabase el rol no existe.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.recuperar_crear(text) to service_role;
  end if;
end $$;

-- Las tablas siguen cerradas a la web (ver esquema.sql): ni lectura ni escritura.
revoke all on all tables in schema public, comun, multibar, autonomialab from public, anon, authenticated;
revoke all on schema comun, multibar, autonomialab from public, anon, authenticated;
