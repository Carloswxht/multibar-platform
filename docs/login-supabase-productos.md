# Pasar un producto al login de Supabase (para las sesiones de MultiBar, Gymbro y los que vengan)

Decisión de Carlos (21 oct): **todas las cuentas usan el login de Supabase** (Supabase Auth), que es más seguro que
el nuestro (equipo de seguridad propio, freno a ataques, verificación en 2 pasos, arreglos automáticos).
La parte común ya está hecha desde `AutonomIA-Lab` (`datos/cambios/2026-10-21-cuentas-supabase.sql`). Cada producto
cambia **su** web y **sus** funciones en **su** sesión, sin tocar `comun`.

## Qué hay ya en la base (no tocarlo desde un producto)
- Cada fila de `comun.usuarios` tiene `auth_id`: su cuenta de Supabase, con **la misma contraseña cifrada**.
  El `id` (número) **no cambia**: el historial (entrenos, pedidos, consentimientos…) sigue colgando de él.
- Mientras dure el cambio, las dos copias se mantienen iguales solas (disparadores en `comun.usuarios` y `auth.users`):
  - alta, cambio de contraseña, de correo o baja (`active = false`) en `comun.usuarios` → se copia a Supabase
    (la baja bloquea la cuenta de Supabase);
  - cambio de contraseña con Supabase (recuperar, «nueva contraseña») → se copia a `comun.usuarios`
    (y pone `must_change_password = false`, `failed_attempts = 0`).
- Un correo = una cuenta en todo autonomIA Lab. Si un producto intenta crear una cuenta con un correo que ya es de un
  miembro de la web, la base lanza `CORREO_EN_USO`.
- `privado.limpiar_correo(texto)`: quita espacios y puntos del final y pasa a minúsculas (el dictado de Carlos).

## Pasos en cada producto (con el «sí» de Carlos)
1. **Funciones nuevas** (su `datos/cambios/`), con su sufijo, que reconocen a la persona por `auth.uid()` en lugar del
   token de sesión propio:
   ```sql
   select u.* from comun.usuarios u join comun.negocios n on n.id = u.negocio_id
    where u.auth_id = auth.uid() and u.active and n.activo and n.tipo = 'gymbro';  -- o 'multibar'…
   ```
   Así una cuenta de un producto nunca abre funciones de otro. Se dan solo a `authenticated` (nunca a `anon`).
   Las funciones viejas (con token) **se quedan** hasta que la web nueva funcione; luego se les quita el permiso
   (`revoke execute`), sin DROP.
2. **Web**: entrar con `supabase.auth.signInWithPassword`, salir con `signOut`, recuperar con
   `resetPasswordForEmail(correo, { redirectTo: 'https://<subdominio>/...' })` y «nueva contraseña» con `updateUser`.
   Limpiar el correo (espacios y puntos del final) antes de mandarlo. La sesión la guarda la librería de Supabase.
3. **Altas de cuentas**: se siguen haciendo en `comun.usuarios` como hoy (la cuenta de Supabase nace sola). Para que la
   persona cree su contraseña, en lugar del enlace de bienvenida propio se le manda el correo de Supabase
   (`resetPasswordForEmail`; máximo uno por minuto y persona).
4. **Plataforma** (`/plataforma/`): entrar con Supabase con la cuenta `carloswxht+plataforma@gmail.com`; el rol se
   comprueba con `privado.es_plataforma()` (ya existe, común).
5. Probar con dos negocios (en local y en Supabase) que nadie ve lo de otro, y que el historial sigue igual
   (contar filas antes y después). Capturas a 390 px.
6. Cuando **todos** los productos hayan pasado: desde `AutonomIA-Lab` se quitan los disparadores de copia y las tablas
   `comun.sesiones` y `comun.recuperaciones` pasan a archivo.

## Lo que hace Carlos en el panel de Supabase (una vez, con pasos guiados desde `AutonomIA-Lab`)
- Authentication → URL Configuration: Site URL `https://autonomialab.es` y en «Redirect URLs» las de cada producto
  (`https://carta.autonomialab.es/**`, `https://gymbro.autonomialab.es/**`…).
- Authentication → Emails → SMTP de Resend y plantillas con la marca.
- Authentication → Sign In / Providers: **desactivar** «Allow new users to sign up» (las cuentas solo las crea la base).
  El registro abierto de Gymbro sigue funcionando porque crea la cuenta en `comun.usuarios` (función de Gymbro).
