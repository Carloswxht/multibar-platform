// =====================================================================
// MultiBar · Edge Function «subir-foto» (v26)
// ---------------------------------------------------------------------
// Corre en el servidor de Supabase (no en la web). El panel (admin) le
// manda { producto, imagen } (y su sesión de Supabase) con la foto ya recortada y reducida
// en el móvil (JPEG en «data:image/jpeg;base64,…»), o imagen = null para
// quitarla. Aquí, con la clave secreta que solo existe dentro de Supabase:
//   1. se pregunta a la base si el token es de un admin de ese bar, con la
//      opción «fotos» encendida, y si el producto es suyo
//      (public.foto_producto_multibar con p_url = null);
//   2. se sube la foto a la carpeta pública «fotos» de Storage, en
//      fotos/<bar>/<producto>-<al azar>.jpg (nunca se pisa una anterior);
//   3. se guarda su dirección en el producto (o '' para quitarla).
// La web nunca puede subir archivos ni poner una dirección cualquiera.
// Las fotos anteriores no se borran (no se borra nada).
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
const MAX_BYTES = 1024 * 1024; // 1 MB (el móvil las deja en ~100–200 KB)

function respuesta(status: number, cuerpo: unknown) {
  return new Response(JSON.stringify(cuerpo), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
function fallo(codigo: string, status = 400) { return respuesta(status, { codigo }); }

// Llama a una función de la base con la clave secreta. Si la base da un
// error con código (SESION_CADUCADA, SIN_PERMISO…), lo devuelve tal cual.
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
  const b = new Uint8Array(9);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export async function atender(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return fallo('METODO', 405);

  const url = Deno.env.get('SUPABASE_URL');
  const clave = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !clave) { console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY'); return fallo('ERROR_SERVIDOR', 500); }

  let datos: { producto?: unknown; imagen?: unknown };
  try { datos = await req.json(); } catch (_) { return fallo('FALTAN_DATOS'); }
  const token = await quien(req, url, clave);
  const producto = Number(datos.producto);
  if (!Number.isInteger(producto) || producto <= 0) return fallo('FALTAN_DATOS');
  if (!token) return fallo('SESION_CADUCADA', 401);

  // Foto: JPEG en base64, de 1 MB como mucho y que empiece como un JPEG de verdad.
  let bytes: Uint8Array | null = null;
  if (datos.imagen !== null && datos.imagen !== undefined) {
    const m = typeof datos.imagen === 'string' ? datos.imagen.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/) : null;
    if (!m || m[1].length > Math.ceil(MAX_BYTES / 3) * 4) return fallo('FOTO_NO_VALIDA');
    try { bytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)); } catch (_) { return fallo('FOTO_NO_VALIDA'); }
    if (bytes.length < 100 || bytes[0] !== 0xFF || bytes[1] !== 0xD8 || bytes[2] !== 0xFF) return fallo('FOTO_NO_VALIDA');
  }

  try {
    // 1. ¿Admin de ese bar, con la opción encendida y el producto es suyo?
    const ok = await rpc(url, clave, 'foto_producto_multibar', { p_token: token, p_producto: producto, p_url: null });
    let direccion = '';
    if (bytes) {
      // 2. Subir la foto con un nombre nuevo.
      const ruta = `${ok.negocio}/${producto}-${azar()}.jpg`;
      const r = await fetch(`${url}/storage/v1/object/fotos/${ruta}`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + clave, apikey: clave, 'Content-Type': 'image/jpeg', 'Cache-Control': '31536000', 'x-upsert': 'false' },
        body: bytes,
      });
      if (!r.ok) { console.error('Storage', r.status, await r.text()); return fallo('ERROR_SERVIDOR', 500); }
      direccion = `${url}/storage/v1/object/public/fotos/${ruta}`;
    }
    // 3. Guardarla en el producto (o quitarla).
    const g = await rpc(url, clave, 'foto_producto_multibar', { p_token: token, p_producto: producto, p_url: direccion });
    return respuesta(200, { foto: g.foto });
  } catch (e) {
    const codigo = e instanceof Error ? e.message : 'ERROR_SERVIDOR';
    return fallo(codigo, codigo === 'ERROR_SERVIDOR' ? 500 : 400);
  }
}

Deno.serve(atender);
