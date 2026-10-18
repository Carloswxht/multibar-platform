-- =====================================================================
-- CAMBIO 18 oct 2026 · Panel de plataforma de MultiBar (v27)
-- ---------------------------------------------------------------------
-- El panel de autonomIA Lab para administrar MultiBar (carta.autonomialab.es
-- /plataforma/, decisión de Carlos del 18 oct): lista de bares con sus
-- números, ficha con sus opciones, dar de baja / reactivar y alta de bares.
--   · negocio nuevo «autonomIA Lab» (tipo 'plataforma'): sus usuarios son
--     las cuentas de plataforma (hoy solo Carlos). No es un bar: la vista
--     bares_multibar pasa a enseñar solo los negocios de tipo 'multibar'.
--   · cuenta de Carlos: carloswxht+plataforma@gmail.com, con una contraseña
--     al azar que nadie sabe; la elige él con «¿Has olvidado tu contraseña?»
--     en /plataforma/ (el correo le lleva allí).
--   · funciones plataforma_* (solo para la cuenta de plataforma) y
--     bienvenida_crear (solo el servidor: correo al dueño de un bar nuevo).
--   · recuperar_crear sirve también a la cuenta de plataforma (mismas
--     respuestas de siempre para el personal de los bares).
-- Sin borrar nada. Se puede volver a ejecutar.
-- =====================================================================
begin;

-- 1. La vista de bares solo enseña bares
create or replace view multibar.bares_multibar as
  select n.id, n.slug, n.nombre, coalesce(a.subtitulo, '') as subtitulo, n.zona_horaria, n.activo,
         coalesce(a.ajustes, '{}'::jsonb) || case when n.titular is null then '{}'::jsonb
           else jsonb_build_object('legal', jsonb_strip_nulls(jsonb_build_object(
             'titular', n.titular, 'nif', n.nif, 'domicilio', n.domicilio_fiscal,
             'email', n.correo_legal, 'telefono', n.telefono_legal, 'registro', n.registro))) end as ajustes,
         n.created_at
    from comun.negocios n left join multibar.ajustes_multibar a on a.negocio_id = n.id
   where n.tipo = 'multibar';  -- el negocio de la plataforma (autonomIA Lab) no es un bar (v27)

-- 2. El negocio de la plataforma y la cuenta de Carlos
insert into comun.negocios (slug, nombre, tipo)
select 'autonomialab', 'autonomIA Lab', 'plataforma'
 where not exists (select 1 from comun.negocios where slug = 'autonomialab');
insert into comun.usuarios (negocio_id, email, name, password_hash, must_change_password)
select n.id, 'carloswxht+plataforma@gmail.com', 'Carlos',
       privado.crypt(encode(privado.gen_random_bytes(24), 'hex'), privado.gen_salt('bf', 10)), true
  from comun.negocios n
 where n.slug = 'autonomialab'
   and not exists (select 1 from comun.usuarios where lower(email) = 'carloswxht+plataforma@gmail.com');

-- 3. Funciones
-- Crea un enlace de recuperación para ese correo (o null si no es de un
-- usuario activo de un bar activo, o si ya pidió 3 en la última hora).
-- Anula los enlaces anteriores sin usar. SOLO para el servidor (service_role).
-- Crea un enlace de un solo uso para elegir contraseña (válido p_minutos).
-- Como mucho 3 por hora y usuario; anula los anteriores sin usar. (v27)
create or replace function privado.crear_enlace(p_usuario integer, p_minutos integer)
returns text
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare v_token text;
begin
  if (select count(*) from comun.recuperaciones
       where usuario_id = p_usuario and created_at > now() - interval '1 hour') >= 3 then
    return null;
  end if;
  update comun.recuperaciones set usado_at = now() where usuario_id = p_usuario and usado_at is null;
  v_token := encode(privado.gen_random_bytes(32), 'hex');
  insert into comun.recuperaciones (token_hash, usuario_id, expires_at)
  values (privado.digest(v_token, 'sha256'), p_usuario, now() + make_interval(mins => p_minutos));
  return v_token;
end $$;

create or replace function public.recuperar_crear(p_email text)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s usuarios_multibar; b bares_multibar; u comun.usuarios; v_token text;
begin
  select * into s from usuarios_multibar where lower(email) = lower(btrim(coalesce(p_email, ''))) and active;
  if not found then
    -- La cuenta de la plataforma (v27): el enlace lleva a /plataforma/.
    select us.* into u from comun.usuarios us join comun.negocios n on n.id = us.negocio_id
     where lower(us.email) = lower(btrim(coalesce(p_email, ''))) and us.active
       and n.tipo = 'plataforma' and n.activo;
    if not found then
      return null;
    end if;
    v_token := privado.crear_enlace(u.id, 30);
    if v_token is null then
      return null;
    end if;
    return jsonb_build_object('token', v_token, 'email', u.email, 'nombre', u.name,
                              'bar_nombre', 'autonomIA Lab', 'bar_slug', '', 'destino', 'plataforma');
  end if;
  select * into b from bares_multibar where id = s.negocio_id and activo;
  if not found then
    return null;
  end if;
  v_token := privado.crear_enlace(s.id, 30);
  if v_token is null then
    return null;
  end if;
  return jsonb_build_object('token', v_token, 'email', s.email, 'nombre', s.name,
                            'bar_nombre', b.nombre, 'bar_slug', b.slug);
end $$;

-- Correo de bienvenida al dueño de un bar recién dado de alta (v27): enlace
-- para elegir su contraseña, válido 3 días. Solo para usuarios que aún no
-- han elegido ninguna (contraseña provisional). Solo para el servidor.
create or replace function public.bienvenida_crear(p_email text)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s usuarios_multibar; b bares_multibar; v_token text;
begin
  select * into s from usuarios_multibar
   where lower(email) = lower(btrim(coalesce(p_email, ''))) and active and must_change_password;
  if not found then
    return null;
  end if;
  select * into b from bares_multibar where id = s.negocio_id and activo;
  if not found then
    return null;
  end if;
  v_token := privado.crear_enlace(s.id, 3 * 24 * 60);
  if v_token is null then
    return null;
  end if;
  return jsonb_build_object('token', v_token, 'email', s.email, 'nombre', s.name,
                            'bar_nombre', b.nombre, 'bar_slug', b.slug, 'bienvenida', true);
end $$;

-- La cuenta de plataforma de este token (o error si no vale).
create or replace function privado.plataforma_de_token(p_token text)
returns comun.usuarios
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare u comun.usuarios;
begin
  if p_token is null or length(p_token) <> 64 then
    raise exception 'SESION_CADUCADA';
  end if;
  select us.* into u
    from comun.sesiones se
    join comun.usuarios us on us.id = se.usuario_id
    join comun.negocios n on n.id = us.negocio_id
   where se.token_hash = privado.digest(p_token, 'sha256')
     and se.expires_at > now()
     and us.active and n.activo and n.tipo = 'plataforma';
  if not found then
    raise exception 'SESION_CADUCADA';
  end if;
  return u;
end $$;

-- Entrar en la plataforma con correo y contraseña (mismas reglas que el panel:
-- 5 fallos = 15 minutos bloqueado; la sesión dura 12 horas).
create or replace function public.plataforma_entrar(p_email text, p_password text)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare u comun.usuarios; v_token text;
begin
  select us.* into u
    from comun.usuarios us join comun.negocios n on n.id = us.negocio_id
   where lower(us.email) = lower(btrim(coalesce(p_email, ''))) and n.tipo = 'plataforma' and n.activo
     for update of us;
  if not found then
    -- Mismo trabajo que con una cuenta real, para no revelar qué correos existen.
    perform privado.crypt(coalesce(p_password, ''), privado.gen_salt('bf', 10));
    return jsonb_build_object('error', 'CREDENCIALES');
  end if;
  if u.locked_until is not null and u.locked_until > now() then
    raise exception 'BLOQUEADO';
  end if;
  if not u.active or u.password_hash <> privado.crypt(coalesce(p_password, ''), u.password_hash) then
    update comun.usuarios
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' end
     where id = u.id;
    return jsonb_build_object('error', 'CREDENCIALES');
  end if;
  update comun.usuarios set failed_attempts = 0, locked_until = null where id = u.id;
  v_token := encode(privado.gen_random_bytes(32), 'hex');
  insert into comun.sesiones (token_hash, usuario_id, expires_at)
  values (privado.digest(v_token, 'sha256'), u.id, now() + interval '12 hours');
  return jsonb_build_object('token', v_token, 'nombre', u.name, 'email', u.email);
end $$;

-- Quién soy (para comprobar que la sesión sigue valiendo al abrir la página).
create or replace function public.plataforma_yo(p_token text)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare u comun.usuarios;
begin
  u := privado.plataforma_de_token(p_token);
  return jsonb_build_object('nombre', u.name, 'email', u.email);
end $$;

-- Números de un bar: hoy (desde el comienzo del día del bar) y últimos 7 días.
-- Pedidos = pedidos enteros (sin 2.ª partes); viajes = los hechos por los
-- clientes desde el móvil (sin los del panel).
create or replace function privado.estadisticas_bar(p_bar integer)
returns jsonb
language sql stable security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
  select jsonb_build_object(
    'pedidos_hoy', count(o.id) filter (where o.created_at >= h.desde and o.parte_de is null),
    'viajes_hoy',  count(o.id) filter (where o.created_at >= h.desde and o.parte_de is null and not o.desde_panel),
    'ventas_hoy',  coalesce(sum(o.total) filter (where o.created_at >= h.desde), 0),
    'pedidos_7d',  count(o.id) filter (where o.parte_de is null),
    'viajes_7d',   count(o.id) filter (where o.parte_de is null and not o.desde_panel),
    'ventas_7d',   coalesce(sum(o.total), 0),
    'ultimo',      (select max(created_at) from pedidos_multibar where negocio_id = p_bar))
  from (select privado.desde_hoy(p_bar) as desde) h
  left join pedidos_multibar o on o.negocio_id = p_bar and o.created_at >= now() - interval '7 days'
$$;

-- Todos los bares (activos primero) con sus números.
create or replace function public.plataforma_bares_multibar(p_token text)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
begin
  perform privado.plataforma_de_token(p_token);
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', b.id, 'slug', b.slug, 'nombre', b.nombre, 'activo', b.activo, 'alta', b.created_at,
            'mesas', (select count(*) from mesas_multibar m where m.negocio_id = b.id and m.active),
            'stats', privado.estadisticas_bar(b.id))
            order by b.activo desc, lower(b.nombre)), '[]'::jsonb)
            from bares_multibar b);
end $$;

-- La ficha de un bar: datos, opciones (ajustes), personal y números.
create or replace function public.plataforma_bar_multibar(p_token text, p_bar integer)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare b bares_multibar;
begin
  perform privado.plataforma_de_token(p_token);
  select * into b from bares_multibar where id = p_bar;
  if not found then
    raise exception 'BAR_NO_VALIDO';
  end if;
  return jsonb_build_object(
    'id', b.id, 'slug', b.slug, 'nombre', b.nombre, 'subtitulo', b.subtitulo, 'activo', b.activo,
    'zona_horaria', b.zona_horaria, 'alta', b.created_at,
    'baja', (select baja_at from comun.negocios where id = b.id),
    'ajustes', b.ajustes,
    'mesas', (select count(*) from mesas_multibar m where m.negocio_id = b.id and m.active),
    'productos', (select count(*) from productos_multibar p where p.negocio_id = b.id and p.visible),
    'usuarios', (select coalesce(jsonb_agg(jsonb_build_object('nombre', s.name, 'email', s.email, 'rol', s.role,
                   'activo', s.active, 'pendiente', s.must_change_password) order by s.role, lower(s.name)), '[]'::jsonb)
                   from usuarios_multibar s where s.negocio_id = b.id),
    'stats', privado.estadisticas_bar(b.id));
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
  foreach k in array array['barra_cocina','avisos_mesa','cuentas_mesa','control_mesas','destacados','horarios','fotos'] loop
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

-- Dar de baja (sin carta ni panel; no se borra nada) o reactivar un bar.
create or replace function public.plataforma_estado_bar_multibar(p_token text, p_bar integer, p_activo boolean)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
begin
  perform privado.plataforma_de_token(p_token);
  if p_activo is null then
    raise exception 'FALTAN_DATOS';
  end if;
  update comun.negocios set activo = p_activo, baja_at = case when p_activo then null else now() end
   where id = p_bar and tipo = 'multibar';
  if not found then
    raise exception 'BAR_NO_VALIDO';
  end if;
  return jsonb_build_object('id', p_bar, 'activo', p_activo);
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
                                    section, price, visible, allergens, sort_order, updated_by)
    select v_id, category_id, name, display_name, description, size, only_size,
           section, price, visible, allergens, sort_order, 'plataforma'
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

-- 4. Permisos
revoke execute on function privado.crear_enlace(integer, integer), privado.plataforma_de_token(text),
  privado.estadisticas_bar(integer) from public, anon, authenticated;
revoke execute on function public.bienvenida_crear(text), public.plataforma_entrar(text, text),
  public.plataforma_yo(text), public.plataforma_bares_multibar(text), public.plataforma_bar_multibar(text, integer),
  public.plataforma_opciones_multibar(text, integer, jsonb), public.plataforma_estado_bar_multibar(text, integer, boolean),
  public.plataforma_alta_bar_multibar(text, jsonb) from public;
revoke execute on function public.bienvenida_crear(text) from anon, authenticated;
grant execute on function public.plataforma_entrar(text, text), public.plataforma_yo(text),
  public.plataforma_bares_multibar(text), public.plataforma_bar_multibar(text, integer),
  public.plataforma_opciones_multibar(text, integer, jsonb), public.plataforma_estado_bar_multibar(text, integer, boolean),
  public.plataforma_alta_bar_multibar(text, jsonb) to anon, authenticated;
grant execute on function public.bienvenida_crear(text) to service_role;

commit;
