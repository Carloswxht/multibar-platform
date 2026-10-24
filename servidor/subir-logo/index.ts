// =====================================================================
// MultiBar · Edge Function «subir-logo» (v29)
// ---------------------------------------------------------------------
// Corre en el servidor de Supabase (no en la web). El panel de plataforma
// le manda { bar, imagen } (y su sesión de Supabase) con el logo ya reducido en el móvil
// («data:image/png;base64,…» o JPEG). Aquí, con la clave secreta que solo
// existe dentro de Supabase:
//   1. se pregunta a la base si el token es de la cuenta de plataforma y
//      si el bar existe (public.plataforma_logo_multibar, que da su slug);
//   2. se sube el logo a la carpeta pública «logos» de Storage, en
//      logos/<slug>-<al azar>.png|jpg (nunca se pisa uno anterior);
//   3. se devuelve su dirección. El logo no cambia en la carta hasta que se
//      guarda el aspecto (plataforma_aspecto_multibar solo acepta logos de
//      esta carpeta).
// Los logos anteriores no se borran (no se borra nada).
//
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los pone Supabase solo.
// Desplegar con verify_jwt = false: la sesión de Supabase (v35) se comprueba
// aquí mismo (función «quien»). El token antiguo de la v34 ya no vale (24 oct).
// =====================================================================

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info',
  'Access-Control-Max-Age': '86400',
};
const MAX_BYTES = 1024 * 1024; // 1 MB (el móvil lo deja en ~50–300 KB)

function respuesta(status: number, cuerpo: unknown) {
  return new Response(JSON.stringify(cuerpo), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
function fallo(codigo: string, status = 400) { return respuesta(status, { codigo }); }

// Llama a una función de la base con la clave secreta. Si la base da un
// error con código (SESION_CADUCADA, BAR_NO_VALIDO…), lo devuelve tal cual.
async function rpc(url: string, clave: string, nombre: string, params: unknown) {
  const r = await fetch(url + '/rest/v1/rpc/' + nombre, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: clave, Authorization: 'Bearer ' + clave },
    body: JSON.stringify(params),
  });
  const texto = await r.text();
  if (!r.ok) {
    let codigo = 'ERROR_SERVIDOR';
    try { const m = String(JSON.parse(texto).message || ''); if (/^[A-Z_]+$/.test(m)) codigo = m; } catch (_) { /* sin JSON */ }
    if (codigo === 'ERROR_SERVIDOR') console.error(nombre, r.status, texto);
    throw new Error(codigo);
  }
  return texto ? JSON.parse(texto) : null;
}

// Login de Supabase (v35): la web manda su sesión de Supabase en la cabecera
// «Authorization: Bearer …». Se comprueba aquí, con Supabase, de quién es, y
// se pasa a la base como «uid:<id>» (la base solo lo acepta con la clave
// secreta). Nunca se acepta un «uid:» que venga de la web.
async function quien(req: Request, url: string, clave: string): Promise<string> {
  const m = (req.headers.get('authorization') || '').match(/^Bearer\s+(\S+)$/i);
  if (!m || m[1] === clave) return '';
  try {
    const r = await fetch(url + '/auth/v1/user', { headers: { apikey: clave, Authorization: 'Bearer ' + m[1] } });
    if (!r.ok) return '';
    const u = await r.json();
    return u && typeof u.id === 'string' && /^[0-9a-f-]{36}$/.test(u.id) ? 'uid:' + u.id : '';
  } catch (_) {
    return '';
  }
}

function azar() {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export async function atender(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return fallo('METODO', 405);

  const url = Deno.env.get('SUPABASE_URL');
  const clave = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !clave) { console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY'); return fallo('ERROR_SERVIDOR', 500); }

  let datos: { bar?: unknown; imagen?: unknown };
  try { datos = await req.json(); } catch (_) { return fallo('FALTAN_DATOS'); }
  const token = await quien(req, url, clave);
  const bar = Number(datos.bar);
  if (!Number.isInteger(bar) || bar <= 0) return fallo('FALTAN_DATOS');
  if (!token) return fallo('SESION_CADUCADA', 401);

  // Logo: PNG o JPEG en base64, de 1 MB como mucho y que empiece como tal.
  const m = typeof datos.imagen === 'string' ? datos.imagen.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/) : null;
  if (!m || m[2].length > Math.ceil(MAX_BYTES / 3) * 4) return fallo('LOGO_NO_VALIDO');
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)); } catch (_) { return fallo('LOGO_NO_VALIDO'); }
  const png = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
  const jpg = bytes.length > 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
  if (bytes.length < 100 || (m[1] === 'png' ? !png : !jpg)) return fallo('LOGO_NO_VALIDO');

  try {
    // 1. ¿Cuenta de plataforma y bar que existe?
    const ok = await rpc(url, clave, 'plataforma_logo_multibar', { p_token: token, p_bar: bar });
    // 2. Subir el logo con un nombre nuevo.
    const ext = m[1] === 'png' ? 'png' : 'jpg';
    const ruta = `${ok.slug}-${azar()}.${ext}`;
    const r = await fetch(`${url}/storage/v1/object/logos/${ruta}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + clave, apikey: clave, 'Content-Type': 'image/' + m[1], 'Cache-Control': '31536000', 'x-upsert': 'false' },
      body: bytes,
    });
    if (!r.ok) { console.error('Storage', r.status, await r.text()); return fallo('ERROR_SERVIDOR', 500); }
    // 3. Su dirección pública (se guarda al guardar el aspecto).
    return respuesta(200, { logo: `${url}/storage/v1/object/public/logos/${ruta}` });
  } catch (e) {
    const codigo = e instanceof Error ? e.message : 'ERROR_SERVIDOR';
    return fallo(codigo, codigo === 'ERROR_SERVIDOR' ? 500 : 400);
  }
}

Deno.serve(atender);
