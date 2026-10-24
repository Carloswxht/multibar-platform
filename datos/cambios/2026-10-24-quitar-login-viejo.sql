-- MultiBar · 24 oct 2026 · Quitar el login viejo (token propio y enlaces de recuperación propios)
-- Base: autonomialab-db (ref dorunbacwnkwdatfscri). Repositorio dueño: multibar-platform.
-- Decisión de Carlos (24 oct): «quita lo viejo, que nadie lo usa; todos los usuarios son de prueba».
--
-- Desde la web v36 todo va con Supabase Auth (entrar, recuperar contraseña y bienvenida). Aquí:
--   1. privado.staff_de_token y privado.plataforma_de_token ya no aceptan el token antiguo de 64
--      letras (solo la sesión de Supabase, auth.uid(), o «uid:<id>» desde las Edge Functions).
--      Comprobado antes: la web de Gymbro (v107) y la de autonomIA Lab no lo usan.
--   2. Nadie (ni la web ni el servidor) puede llamar ya a personal_entrar, personal_salir,
--      personal_cambiar_password, personal_restablecer, plataforma_entrar, recuperar_crear ni
--      bienvenida_crear. Las funciones se quedan (sin DROP) y comun.sesiones no se toca.
-- Sin DELETE ni DROP. Se puede volver a aplicar.

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
  -- El token antiguo de 64 letras (web v34 y anteriores) ya no vale (24 oct).
  raise exception 'SESION_CADUCADA';
end $$;

create or replace function privado.plataforma_de_token(p_token text)
returns comun.usuarios
language plpgsql security definer
set search_path = public, comun, multibar, privado, pg_temp
as $$
declare u comun.usuarios; v_uid uuid;
begin
  -- Login de Supabase (v35): igual que privado.staff_de_token. La usan
  -- también las funciones de plataforma de Gymbro (sin token).
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
  -- El token antiguo de 64 letras ya no vale (24 oct; ni MultiBar ni Gymbro lo usan).
  raise exception 'SESION_CADUCADA';
end $$;

-- Login antiguo (token propio de 64 letras y enlaces de recuperación propios,
-- web v18 a v35): desde el 24 oct nadie lo usa (todo con Supabase Auth). Las
-- funciones se quedan, pero nadie puede llamarlas (sin DROP: no se borra nada).
-- Ver datos/cambios/2026-10-24-quitar-login-viejo.sql.
revoke all on function public.personal_entrar(text, text) from public, anon, authenticated;
revoke all on function public.personal_salir(text) from public, anon, authenticated;
revoke all on function public.personal_cambiar_password(text, text, text) from public, anon, authenticated;
revoke all on function public.personal_restablecer(text, text) from public, anon, authenticated;
revoke all on function public.plataforma_entrar(text, text) from public, anon, authenticated;
revoke all on function public.recuperar_crear(text) from public, anon, authenticated;
revoke all on function public.bienvenida_crear(text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on function public.personal_entrar(text, text) from service_role;
    revoke all on function public.personal_salir(text) from service_role;
    revoke all on function public.personal_cambiar_password(text, text, text) from service_role;
    revoke all on function public.personal_restablecer(text, text) from service_role;
    revoke all on function public.plataforma_entrar(text, text) from service_role;
    revoke all on function public.recuperar_crear(text) from service_role;
    revoke all on function public.bienvenida_crear(text) from service_role;
  end if;
end $$;

