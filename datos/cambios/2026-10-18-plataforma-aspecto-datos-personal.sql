-- =====================================================================
-- 18 oct 2026 · Panel de plataforma, entrega 2 (v29)
-- ---------------------------------------------------------------------
-- Desde /plataforma/ se puede cambiar el aspecto de cada bar (colores,
-- letras, logo, cabecera y textos, con vista previa), sus datos (nombre,
-- subtítulo, pie de la carta y titular del aviso legal) y su personal
-- (dar de alta con correo de bienvenida, nombre, rol y activo).
--   · plataforma_bar_multibar: ahora devuelve el id de cada persona.
--   · privado.limpiar_aspecto: comprueba el aspecto (solo claves y valores válidos).
--   · plataforma_aspecto_multibar, plataforma_datos_bar_multibar,
--     plataforma_usuario_multibar: para la web (con la sesión de plataforma).
--   · plataforma_logo_multibar: solo para el servidor (Edge Function «subir-logo»).
-- Sin borrar nada: desactivar a una persona hace caducar sus sesiones.
-- Se puede volver a ejecutar entero.
-- =====================================================================

begin;

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
    'usuarios', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.name, 'email', s.email, 'rol', s.role,
                   'activo', s.active, 'pendiente', s.must_change_password) order by s.role, lower(s.name)), '[]'::jsonb)
                   from usuarios_multibar s where s.negocio_id = b.id),
    'stats', privado.estadisticas_bar(b.id));
end $$;

-- Comprueba y limpia el aspecto que manda la plataforma (formato en
-- comun/aspecto.js). Solo pasan las claves conocidas con valores válidos;
-- lo vacío se quita (la carta usa entonces el valor de MultiBar).
create or replace function privado.limpiar_aspecto(a jsonb)
returns jsonb
language plpgsql immutable
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare r jsonb := '{}'::jsonb; x jsonb; k text; v text;
begin
  if a is null or jsonb_typeof(a) <> 'object' then
    raise exception 'ASPECTO_NO_VALIDO';
  end if;
  for k in select jsonb_object_keys(a) loop
    if k not in ('plantilla','colores','fuentes','logo','cabecera','icono','nombre_corto','textos') then
      raise exception 'ASPECTO_NO_VALIDO';
    end if;
  end loop;
  if coalesce(a->>'plantilla', '') <> '' then
    if a->>'plantilla' not in ('clasica') then raise exception 'ASPECTO_NO_VALIDO'; end if;
    r := r || jsonb_build_object('plantilla', a->>'plantilla');
  end if;
  if jsonb_typeof(a->'colores') = 'object' then
    x := '{}'::jsonb;
    for k, v in select key, value from jsonb_each_text(a->'colores') loop
      if k not in ('principal','principal_oscuro','acento','acento_oscuro','fondo','fondo_2','texto')
         or v !~ '^#[0-9A-Fa-f]{6}$' then
        raise exception 'ASPECTO_NO_VALIDO';
      end if;
      x := x || jsonb_build_object(k, upper(v));
    end loop;
    if x <> '{}'::jsonb then r := r || jsonb_build_object('colores', x); end if;
  elsif a ? 'colores' and jsonb_typeof(a->'colores') <> 'null' then
    raise exception 'ASPECTO_NO_VALIDO';
  end if;
  if jsonb_typeof(a->'fuentes') = 'object' then
    x := '{}'::jsonb;
    for k, v in select key, value from jsonb_each_text(a->'fuentes') loop
      if k not in ('titulos','texto')
         or v not in ('oswald','dmsans','playfair','lora','montserrat','bebas','robotoslab','nunito','sistema') then
        raise exception 'ASPECTO_NO_VALIDO';
      end if;
      x := x || jsonb_build_object(k, v);
    end loop;
    if x <> '{}'::jsonb then r := r || jsonb_build_object('fuentes', x); end if;
  elsif a ? 'fuentes' and jsonb_typeof(a->'fuentes') <> 'null' then
    raise exception 'ASPECTO_NO_VALIDO';
  end if;
  -- Imágenes: solo de la carpeta pública de logos de Storage o de esta web.
  foreach k in array array['logo','icono'] loop
    v := btrim(coalesce(a->>k, ''));
    if v <> '' then
      if v !~ '^https://[a-z0-9.-]+/storage/v1/object/public/logos/[a-z0-9-]+\.(png|jpg|webp)$'
         and v !~ '^datos/bares/[a-z0-9-]+/[A-Za-z0-9_.-]+\.(png|jpg|jpeg|webp)$' then
        raise exception 'ASPECTO_NO_VALIDO';
      end if;
      r := r || jsonb_build_object(k, v);
    end if;
  end loop;
  if coalesce(a->>'cabecera', '') <> '' then
    if a->>'cabecera' not in ('nombre','logo','logo_y_nombre') then raise exception 'ASPECTO_NO_VALIDO'; end if;
    r := r || jsonb_build_object('cabecera', a->>'cabecera');
  end if;
  v := btrim(coalesce(a->>'nombre_corto', ''));
  if v <> '' then
    if length(v) > 30 then raise exception 'ASPECTO_NO_VALIDO'; end if;
    r := r || jsonb_build_object('nombre_corto', v);
  end if;
  if jsonb_typeof(a->'textos') = 'object' then
    x := '{}'::jsonb;
    for k, v in select key, value from jsonb_each_text(a->'textos') loop
      if k not in ('ver_tique','tu_tique','total','enviar','pie_mirar','pie_pedir','tique_vacio')
         or length(btrim(coalesce(v, ''))) > 120 then
        raise exception 'ASPECTO_NO_VALIDO';
      end if;
      if btrim(coalesce(v, '')) <> '' then x := x || jsonb_build_object(k, btrim(v)); end if;
    end loop;
    if x <> '{}'::jsonb then r := r || jsonb_build_object('textos', x); end if;
  elsif a ? 'textos' and jsonb_typeof(a->'textos') <> 'null' then
    raise exception 'ASPECTO_NO_VALIDO';
  end if;
  return r;
end $$;

-- Guarda el aspecto de un bar (lo sustituye entero; el resto de ajustes no se toca).
create or replace function public.plataforma_aspecto_multibar(p_token text, p_bar integer, p_aspecto jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare v jsonb;
begin
  perform privado.plataforma_de_token(p_token);
  perform 1 from bares_multibar where id = p_bar;
  if not found then
    raise exception 'BAR_NO_VALIDO';
  end if;
  v := privado.limpiar_aspecto(p_aspecto);
  insert into ajustes_multibar (negocio_id, ajustes) values (p_bar, jsonb_build_object('aspecto', v))
  on conflict (negocio_id) do update set ajustes = ajustes_multibar.ajustes || jsonb_build_object('aspecto', v);
  return v;
end $$;

-- Datos del bar: nombre, subtítulo, líneas del pie de la carta y titular
-- para el aviso legal. Solo cambia lo que llega en p_datos.
-- p_datos: {nombre?, subtitulo?, pie?: [texto…], legal?: {titular, nif, domicilio, email, telefono, registro}}
create or replace function public.plataforma_datos_bar_multibar(p_token text, p_bar integer, p_datos jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare d jsonb := coalesce(p_datos, '{}'::jsonb); l jsonb; v_pie jsonb; v text; k text;
begin
  perform privado.plataforma_de_token(p_token);
  perform 1 from bares_multibar where id = p_bar;
  if not found then
    raise exception 'BAR_NO_VALIDO';
  end if;
  if jsonb_typeof(d) <> 'object' then
    raise exception 'FALTAN_DATOS';
  end if;
  if d ? 'nombre' then
    v := btrim(coalesce(d->>'nombre', ''));
    if v = '' or length(v) > 60 then raise exception 'FALTAN_DATOS'; end if;
    update comun.negocios set nombre = v where id = p_bar;
  end if;
  if d ? 'subtitulo' then
    v := btrim(coalesce(d->>'subtitulo', ''));
    if length(v) > 80 then raise exception 'DATOS_NO_VALIDOS'; end if;
    insert into ajustes_multibar (negocio_id, subtitulo) values (p_bar, v)
    on conflict (negocio_id) do update set subtitulo = excluded.subtitulo;
  end if;
  if d ? 'pie' then
    if jsonb_typeof(d->'pie') <> 'array' or jsonb_array_length(d->'pie') > 8 then
      raise exception 'DATOS_NO_VALIDOS';
    end if;
    select coalesce(jsonb_agg(btrim(e)), '[]'::jsonb) into v_pie
      from jsonb_array_elements_text(d->'pie') e where btrim(e) <> '';
    if exists (select 1 from jsonb_array_elements_text(v_pie) e where length(e) > 200) then
      raise exception 'DATOS_NO_VALIDOS';
    end if;
    insert into ajustes_multibar (negocio_id, ajustes) values (p_bar, jsonb_build_object('pie', v_pie))
    on conflict (negocio_id) do update set ajustes =
      case when v_pie = '[]'::jsonb then ajustes_multibar.ajustes - 'pie'
           else ajustes_multibar.ajustes || jsonb_build_object('pie', v_pie) end;
  end if;
  if d ? 'legal' then
    l := d->'legal';
    if jsonb_typeof(l) <> 'object' then raise exception 'DATOS_NO_VALIDOS'; end if;
    for k in select jsonb_object_keys(l) loop
      if k not in ('titular','nif','domicilio','email','telefono','registro')
         or length(coalesce(l->>k, '')) > 200 then
        raise exception 'DATOS_NO_VALIDOS';
      end if;
    end loop;
    if nullif(btrim(l->>'email'), '') is not null
       and btrim(l->>'email') !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
      raise exception 'EMAIL_NO_VALIDO';
    end if;
    update comun.negocios set
      titular          = nullif(btrim(l->>'titular'), ''),
      nif              = nullif(btrim(l->>'nif'), ''),
      domicilio_fiscal = nullif(btrim(l->>'domicilio'), ''),
      correo_legal     = nullif(btrim(l->>'email'), ''),
      telefono_legal   = nullif(btrim(l->>'telefono'), ''),
      registro         = nullif(btrim(l->>'registro'), '')
    where id = p_bar;
  end if;
  return public.plataforma_bar_multibar(p_token, p_bar);
end $$;

-- Personal de un bar desde la plataforma: dar de alta (con contraseña
-- provisional al azar: la persona la elige con el correo de bienvenida),
-- cambiar nombre, rol o activo. Desactivar cierra sus sesiones (caducan ya).
-- p_datos: {id?, nombre, email (solo al dar de alta), rol, activo?}
create or replace function public.plataforma_usuario_multibar(p_token text, p_bar integer, p_datos jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare d jsonb := coalesce(p_datos, '{}'::jsonb); v_id int; v_email text; v_nombre text; v_nuevo boolean;
begin
  perform privado.plataforma_de_token(p_token);
  perform 1 from bares_multibar where id = p_bar;
  if not found then
    raise exception 'BAR_NO_VALIDO';
  end if;
  if d->>'rol' is not null and d->>'rol' not in ('camarero','barra','admin') then
    raise exception 'ROL_NO_VALIDO';
  end if;
  v_nombre := nullif(btrim(d->>'nombre'), '');
  if v_nombre is not null and length(v_nombre) > 60 then
    raise exception 'FALTAN_DATOS';
  end if;
  v_nuevo := not (d ? 'id' and d->>'id' is not null);
  if v_nuevo then
    v_email := lower(btrim(coalesce(d->>'email', '')));
    if v_nombre is null or d->>'rol' is null then
      raise exception 'FALTAN_DATOS';
    end if;
    if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
      raise exception 'EMAIL_NO_VALIDO';
    end if;
    if exists (select 1 from comun.usuarios where lower(email) = v_email) then
      raise exception 'EMAIL_EN_USO';
    end if;
    insert into comun.usuarios (negocio_id, email, name, password_hash, must_change_password)
    values (p_bar, v_email, v_nombre,
            privado.crypt(encode(privado.gen_random_bytes(24), 'hex'), privado.gen_salt('bf', 10)), true)
    returning id into v_id;
    insert into personal_multibar (usuario_id, negocio_id, role) values (v_id, p_bar, d->>'rol');
  else
    if d->>'id' !~ '^[0-9]{1,9}$' then
      raise exception 'USUARIO_NO_VALIDO';
    end if;
    update comun.usuarios set
      name   = coalesce(v_nombre, name),
      active = coalesce((d->>'activo')::boolean, active)
    where id = (d->>'id')::int and negocio_id = p_bar
    returning id, email into v_id, v_email;
    if v_id is null or not exists (select 1 from personal_multibar where usuario_id = v_id) then
      raise exception 'USUARIO_NO_VALIDO';
    end if;
    update personal_multibar set role = coalesce(d->>'rol', role) where usuario_id = v_id;
    if (d->>'activo')::boolean is false then
      update comun.sesiones set expires_at = now() where usuario_id = v_id and expires_at > now();
    end if;
  end if;
  if not exists (select 1 from usuarios_multibar where negocio_id = p_bar and role = 'admin' and active) then
    raise exception 'ULTIMO_ADMIN';
  end if;
  return jsonb_build_object('id', v_id, 'email', v_email, 'nuevo', v_nuevo);
end $$;

-- Para la función del servidor «subir-logo»: ¿es la cuenta de plataforma y
-- existe el bar? Devuelve su dirección corta (para nombrar el archivo).
-- Solo para el servidor (service_role).
create or replace function public.plataforma_logo_multibar(p_token text, p_bar integer)
returns jsonb
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare v_slug text;
begin
  perform privado.plataforma_de_token(p_token);
  select slug into v_slug from bares_multibar where id = p_bar;
  if not found then
    raise exception 'BAR_NO_VALIDO';
  end if;
  return jsonb_build_object('slug', v_slug);
end $$;

revoke execute on function privado.limpiar_aspecto(jsonb) from public, anon, authenticated;
revoke execute on function public.plataforma_aspecto_multibar(text, integer, jsonb),
  public.plataforma_datos_bar_multibar(text, integer, jsonb),
  public.plataforma_usuario_multibar(text, integer, jsonb),
  public.plataforma_logo_multibar(text, integer) from public;
revoke execute on function public.plataforma_logo_multibar(text, integer) from anon, authenticated;
grant execute on function public.plataforma_aspecto_multibar(text, integer, jsonb),
  public.plataforma_datos_bar_multibar(text, integer, jsonb),
  public.plataforma_usuario_multibar(text, integer, jsonb) to anon, authenticated;
grant execute on function public.plataforma_logo_multibar(text, integer) to service_role;

commit;
