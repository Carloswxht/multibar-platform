-- =====================================================================
-- 22 oct 2026 · Login de Supabase en el panel y la plataforma (v35)
-- ---------------------------------------------------------------------
-- Sigue la guía común (AutonomIA-Lab, docs/login-supabase-productos.md):
-- las cuentas ya tienen su cuenta de Supabase (comun.usuarios.auth_id,
-- misma contraseña; lo hizo AutonomIA-Lab el 21 oct).
-- En lugar de duplicar las ~40 funciones del panel y de la plataforma, se
-- enseña a las dos «porterías» por las que pasan todas a reconocer la
-- sesión de Supabase:
--   * sin token (null o ''): la persona es auth.uid(), y tiene que ser
--     personal activo de un bar activo (o la cuenta de plataforma);
--   * «uid:<id>»: solo con la clave secreta del servidor (Edge Functions
--     subir-foto y subir-logo, que ya han comprobado la sesión).
-- Con token (web v34, panel de plataforma de Gymbro) todo sigue igual.
-- Sin borrar nada. Se puede volver a ejecutar entero.
-- =====================================================================

begin;

-- Quién es el usuario del personal de este token (o error si no vale).
-- Si su bar está desactivado, la sesión deja de valer.
create or replace function privado.staff_de_token(p_token text)
returns multibar.usuarios_multibar
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare s multibar.usuarios_multibar; v_uid uuid;
begin
  -- Login de Supabase (v35): sin token, la persona es la de su sesión de
  -- Supabase (auth.uid()). «uid:<id>» solo lo acepta la clave secreta del
  -- servidor (Edge Functions, que ya han comprobado la sesión de Supabase).
  if coalesce(p_token, '') = '' then
    v_uid := auth.uid();
  elsif p_token like 'uid:%' and (coalesce(auth.role(), '') = 'service_role'
                                   or coalesce(current_setting('role', true), '') = 'service_role') then
    begin
      v_uid := substr(p_token, 5)::uuid;
    exception when others then
      raise exception 'SESION_CADUCADA';
    end;
  end if;
  if v_uid is not null then
    select st.* into s
      from comun.usuarios u
      join multibar.usuarios_multibar st on st.id = u.id
      join multibar.bares_multibar b on b.id = st.negocio_id
     where u.auth_id = v_uid and st.active and b.activo;
    if not found then
      raise exception 'SESION_CADUCADA';
    end if;
    return s;
  end if;
  if p_token is null or length(p_token) <> 64 then
    raise exception 'SESION_CADUCADA';
  end if;
  select st.* into s
    from comun.sesiones se
    join multibar.usuarios_multibar st on st.id = se.usuario_id
    join multibar.bares_multibar b on b.id = st.negocio_id
   where se.token_hash = privado.digest(p_token, 'sha256')
     and se.expires_at > now()
     and st.active and b.activo;
  if not found then
    raise exception 'SESION_CADUCADA';
  end if;
  return s;
end $$;

-- La cuenta de plataforma de este token (o error si no vale).
create or replace function privado.plataforma_de_token(p_token text)
returns comun.usuarios
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare u comun.usuarios; v_uid uuid;
begin
  -- Login de Supabase (v35): igual que privado.staff_de_token. La usan
  -- también las funciones de plataforma de Gymbro: con token, todo igual.
  if coalesce(p_token, '') = '' then
    v_uid := auth.uid();
  elsif p_token like 'uid:%' and (coalesce(auth.role(), '') = 'service_role'
                                   or coalesce(current_setting('role', true), '') = 'service_role') then
    begin
      v_uid := substr(p_token, 5)::uuid;
    exception when others then
      raise exception 'SESION_CADUCADA';
    end;
  end if;
  if v_uid is not null then
    select us.* into u
      from comun.usuarios us
      join comun.negocios n on n.id = us.negocio_id
     where us.auth_id = v_uid and us.active and n.activo and n.tipo = 'plataforma';
    if not found then
      raise exception 'SESION_CADUCADA';
    end if;
    return u;
  end if;
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

commit;
