// =====================================================================
// MultiBar · Edge Function «recuperar-contrasena» (v18)
// ---------------------------------------------------------------------
// Corre en el servidor de Supabase (no en la web). La entrada del panel
// le manda { email }; aquí, con la clave secreta que solo existe dentro
// de Supabase, se pide a la base un enlace (public.recuperar_crear) y se
// manda por correo con Resend. Contesta SIEMPRE { ok: true } y tarda lo
// mismo, exista o no el correo: así nadie puede averiguar quién trabaja
// en qué bar. Los límites (3 enlaces por hora, 30 minutos, un solo uso)
// los pone la base.
// v27: con { email, bienvenida: true } manda el correo de bienvenida al
// dueño de un bar recién dado de alta (public.bienvenida_crear: solo si aún
// no ha elegido contraseña; enlace de 3 días). Y si el correo es de la
// cuenta de plataforma, el enlace lleva a /plataforma/ en vez de al panel.
//
// Secretos (Supabase → Edge Functions → Secrets; nunca en el repositorio):
//   RESEND_API_KEY  clave de Resend (la pone Carlos)
//   REMITENTE       opcional; por defecto "MultiBar <avisos@autonomialab.com>"
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los pone Supabase solo.
// Desplegar con verify_jwt = false (la web no tiene sesión de Supabase).
// =====================================================================

const WEB = 'https://carta.autonomialab.es';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info',
  'Access-Control-Max-Age': '86400',
};

function respuesta(status: number, cuerpo: unknown) {
  return new Response(JSON.stringify(cuerpo), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function esc(t: string) {
  return String(t ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

type Enlace = { token: string; email: string; nombre: string; bar_nombre: string; bar_slug: string;
  destino?: string; bienvenida?: boolean };

async function crearEnlace(email: string, bienvenida: boolean): Promise<Enlace | null> {
  const url = Deno.env.get('SUPABASE_URL');
  const clave = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !clave) { console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY'); return null; }
  const r = await fetch(url + '/rest/v1/rpc/' + (bienvenida ? 'bienvenida_crear' : 'recuperar_crear'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: clave, Authorization: 'Bearer ' + clave },
    body: JSON.stringify({ p_email: email }),
  });
  if (!r.ok) { console.error('recuperar_crear', r.status, await r.text()); return null; }
  return await r.json();
}

async function mandarCorreo(e: Enlace) {
  const clave = Deno.env.get('RESEND_API_KEY');
  if (!clave) { console.error('Falta el secreto RESEND_API_KEY'); return; }
  const remitente = Deno.env.get('REMITENTE') || 'MultiBar <avisos@autonomialab.com>';
  const plataforma = e.destino === 'plataforma';
  const enlace = plataforma ? `${WEB}/plataforma/#recuperar=${e.token}`
    : `${WEB}/panel/?bar=${encodeURIComponent(e.bar_slug)}#recuperar=${e.token}`;
  const bar = esc(e.bar_nombre), nombre = esc(e.nombre);
  if (e.bienvenida) return mandarBienvenida(e, enlace, clave, remitente);
  const lugar = plataforma ? 'la plataforma de MultiBar' : 'el panel';
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f4f4f6;font-family:Arial,Helvetica,sans-serif;color:#1f2430">
<div style="max-width:480px;margin:0 auto;padding:24px 16px">
  <div style="background:#fff;border-radius:12px;padding:24px;border:1px solid #e3e4e8">
    <p style="margin:0 0 4px;font-size:13px;letter-spacing:.06em;color:#6b7080;text-transform:uppercase">${plataforma ? 'Plataforma · MultiBar' : 'Panel de ' + bar}</p>
    <h1 style="margin:0 0 16px;font-size:20px">Contraseña nueva</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5">Hola ${nombre}: alguien (seguramente tú) ha pedido cambiar la contraseña de ${lugar}. Toca el botón para elegir una nueva.</p>
    <p style="margin:0 0 20px;text-align:center"><a href="${enlace}" style="display:inline-block;background:#D9722A;color:#fff;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 24px;border-radius:8px">Elegir contraseña nueva</a></p>
    <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#6b7080">El enlace vale <b>30 minutos</b> y una sola vez. Si no lo has pedido tú, no hagas nada: tu contraseña sigue siendo la misma.</p>
  </div>
  <p style="margin:16px 0 0;text-align:center;font-size:11px;color:#8a8f9c">Panel por autonomIA Lab · MultiBar</p>
</div></body></html>`;
  const texto = `${plataforma ? 'Plataforma · MultiBar' : 'Panel de ' + e.bar_nombre}\n\nHola ${e.nombre}: alguien (seguramente tú) ha pedido cambiar la contraseña de ${lugar}.\n` +
    `Abre este enlace para elegir una nueva (vale 30 minutos y una sola vez):\n${enlace}\n\n` +
    `Si no lo has pedido tú, no hagas nada: tu contraseña sigue siendo la misma.\n\nPanel por autonomIA Lab · MultiBar`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + clave },
    body: JSON.stringify({ from: remitente, to: [e.email], subject: `Contraseña nueva · ${plataforma ? 'Plataforma MultiBar' : 'Panel de ' + e.bar_nombre}`, html, text: texto }),
  });
  if (!r.ok) console.error('Resend', r.status, await r.text());
}

// Bienvenida al dueño de un bar nuevo (v27): su panel ya está listo y elige su contraseña.
async function mandarBienvenida(e: Enlace, enlace: string, clave: string, remitente: string) {
  const bar = esc(e.bar_nombre), nombre = esc(e.nombre);
  const panel = `${WEB}/panel/?bar=${encodeURIComponent(e.bar_slug)}`;
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f4f4f6;font-family:Arial,Helvetica,sans-serif;color:#1f2430">
<div style="max-width:480px;margin:0 auto;padding:24px 16px">
  <div style="background:#fff;border-radius:12px;padding:24px;border:1px solid #e3e4e8">
    <p style="margin:0 0 4px;font-size:13px;letter-spacing:.06em;color:#6b7080;text-transform:uppercase">Panel de ${bar}</p>
    <h1 style="margin:0 0 16px;font-size:20px">Tu panel ya está listo</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5">Hola ${nombre}: ya tienes la carta digital y el panel de pedidos de ${bar}. Toca el botón para elegir tu contraseña y entrar.</p>
    <p style="margin:0 0 20px;text-align:center"><a href="${enlace}" style="display:inline-block;background:#D9722A;color:#fff;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 24px;border-radius:8px">Elegir mi contraseña</a></p>
    <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#6b7080">El botón vale <b>3 días</b> y una sola vez. Después, entra siempre en <a href="${panel}" style="color:#6b7080">${esc(panel)}</a> con este correo. Si se te pasa, usa «¿Has olvidado tu contraseña?» en esa página.</p>
  </div>
  <p style="margin:16px 0 0;text-align:center;font-size:11px;color:#8a8f9c">Panel por autonomIA Lab · MultiBar</p>
</div></body></html>`;
  const texto = `Panel de ${e.bar_nombre}\n\nHola ${e.nombre}: ya tienes la carta digital y el panel de pedidos de ${e.bar_nombre}.\n` +
    `Abre este enlace para elegir tu contraseña (vale 3 días y una sola vez):\n${enlace}\n\n` +
    `Después, entra siempre en ${panel} con este correo.\n\nPanel por autonomIA Lab · MultiBar`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + clave },
    body: JSON.stringify({ from: remitente, to: [e.email], subject: `Tu panel de ${e.bar_nombre} ya está listo`, html, text: texto }),
  });
  if (!r.ok) console.error('Resend', r.status, await r.text());
}

async function trabajo(email: string, bienvenida: boolean) {
  try {
    let e = await crearEnlace(email, bienvenida);
    // Si ya eligió su contraseña, la bienvenida no vale: se manda el de
    // «contraseña nueva» (v28), así «Mandar enlace» siempre manda algo.
    if (!(e && e.token) && bienvenida) e = await crearEnlace(email, false);
    if (e && e.token) await mandarCorreo(e);
  } catch (err) { console.error('recuperar-contrasena', err); }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return respuesta(405, { ok: false });
  let email = '', bienvenida = false;
  try {
    const cuerpo = await req.json();
    email = String(cuerpo?.email ?? '').trim().slice(0, 200);
    bienvenida = cuerpo?.bienvenida === true;
  } catch { /* cuerpo malo */ }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    // Se trabaja después de contestar: la respuesta tarda lo mismo con o sin usuario.
    const p = trabajo(email, bienvenida);
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime;
    if (rt && typeof rt.waitUntil === 'function') rt.waitUntil(p); else await p;
  }
  return respuesta(200, { ok: true });
});
