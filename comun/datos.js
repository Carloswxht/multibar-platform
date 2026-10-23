/* =====================================================================
   ACCESO A DATOS Y LOGIN · MultiBar (todos los bares)
   ---------------------------------------------------------------------
   Este es el ÚNICO sitio donde la carta y el panel hablan con la base
   de datos. Para cambiar de base, solo se cambia este archivo.

   Base de datos: proyecto Supabase "multi-bar" (Frankfurt), separado de
   El Recreo (antes estuvo en Neon). Una sola base para todos los bares:
   cada llamada de la carta dice de qué bar es (BAR) y el personal solo ve
   lo de su bar. Aquí solo va la clave PÚBLICA de Supabase ("publishable",
   pensada para ir en la web): con ella la base solo deja usar las
   funciones de datos/funciones.sql. NUNCA poner aquí claves secretas
   (service_role, secret ni la contraseña de la base).
   ===================================================================== */

/* ---------------- DIRECCIÓN Y CLAVE PÚBLICA DE LA BASE ---------------- */
const SUPABASE_URL = 'https://dorunbacwnkwdatfscri.supabase.co';
const DATA_API = SUPABASE_URL + '/rest/v1';
const CLAVE_PUBLICA = 'sb_publishable_PK12CcvGBEZsFT9lsLpSIA_IsP-v8iS';
// Pequeños programas del servidor de Supabase (Edge Functions): «subir-foto»,
// «subir-logo» y «recuperar-contrasena» (enlaces de la v35, mientras queden).
const FUNCIONES_API = 'https://dorunbacwnkwdatfscri.supabase.co/functions/v1';

/* ---------------- QUÉ BAR ES ----------------
   El bar va en el enlace de la carta y del QR: /carta/?bar=lamardegambas&mesa=5&c=…
   Si el enlace no lo lleva (o no es válido), BAR queda vacío: la carta y
   la página legal mandan a la página de MultiBar (raíz, "escanea el QR de
   tu mesa") y nunca abren un bar por su cuenta.
   En el panel, el bar es el del usuario que entra (usarBar). */
let BAR = (function(){
  try {
    const b = (new URLSearchParams(window.location.search).get('bar') || '').trim().toLowerCase();
    return /^[a-z0-9][a-z0-9-]{1,39}$/.test(b) ? b : '';
  } catch(e) { return ''; }
})();
function usarBar(slug){ if(slug) BAR = slug; }

/* ---------------- LLAMADA A LAS "VENTANILLAS" DE LA BASE ----------------
   La web no toca tablas: solo llama a funciones de la base (ver
   datos/funciones.sql), que comprueban todo. Cada llamada lleva la clave
   pública de Supabase. Con el login de Supabase (v35), las del panel y la
   plataforma llevan además la sesión de la persona (jwt). */
async function apiRpc(nombre, params, jwt){
  // Con mala cobertura una llamada puede quedarse colgada: se corta a los 20 s.
  const corte = window.AbortController ? new AbortController() : null;
  const reloj = corte ? setTimeout(() => corte.abort(), 20000) : null;
  let res;
  try {
    const r = await fetch(DATA_API + '/rpc/' + nombre, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', 'apikey': CLAVE_PUBLICA }, jwt ? { 'Authorization': 'Bearer ' + jwt } : {}),
      cache: 'no-store', body: JSON.stringify(params || {}),
      signal: corte ? corte.signal : undefined,
    });
    res = { status: r.status, ok: r.ok, texto: await r.text() };
  } catch(e) {
    throw new ErrorDatos('SIN_CONEXION');
  } finally { if(reloj) clearTimeout(reloj); }
  let datos = null;
  try { datos = res.texto ? JSON.parse(res.texto) : null; } catch(e) { /* respuesta vacía */ }
  if(!res.ok){
    const msg = (datos && datos.message) || ('HTTP_' + res.status);
    throw new ErrorDatos(msg);
  }
  return datos;
}

/* Error con un código de la base (MESA_NO_VALIDA, AGOTADO:Gambas…) y un
   texto en español para enseñar al usuario. */
class ErrorDatos extends Error {
  constructor(codigo){
    super(textoError(codigo));
    this.codigo = String(codigo || '').split(':')[0];
    this.detalle = String(codigo || '').split(':').slice(1).join(':');
  }
}

function textoError(codigo){
  const c = String(codigo || '');
  const [base, detalle] = [c.split(':')[0], c.split(':').slice(1).join(':')];
  const textos = {
    SIN_CONEXION: 'No hay conexión. Comprueba la cobertura e inténtalo otra vez.',
    MESA_NO_VALIDA: 'Este código QR no es válido. Pide ayuda al camarero.',
    MESA_CERRADA: 'Tu mesa todavía no está abierta para pedir. Pide al camarero que la abra y vuelve a intentarlo.',
    BAR_NO_VALIDO: 'Este bar no está disponible ahora mismo.',
    EMAIL_EN_USO: 'Ya hay un usuario con ese correo.',
    ESPERA_UN_MOMENTO: 'Acabas de enviar un pedido. Espera unos segundos.',
    LIMITE_MOVIL: 'Has enviado muchos pedidos en poco tiempo. Avisa al camarero.',
    LIMITE_MESA: 'Esta mesa ha enviado muchos pedidos seguidos. Avisa al camarero.',
    PEDIDO_VACIO: 'El pedido está vacío.',
    DEMASIADAS_LINEAS: 'El pedido es demasiado largo. Divídelo en dos.',
    CANTIDAD_NO_VALIDA: 'Como mucho 20 unidades de cada producto.',
    PRODUCTO_NO_VALIDO: 'Algún producto ya no está en la carta. Recarga la página.',
    AGOTADO: 'Lo sentimos, se ha agotado: ' + (detalle || 'un producto') + '.',
    YA_NO_EDITABLE: 'El pedido ya está en marcha y no se puede cambiar. Avisa al camarero.',
    PEDIDO_NO_ENCONTRADO: 'No se encuentra el pedido.',
    DISPOSITIVO_NO_VALIDO: 'Recarga la página e inténtalo otra vez.',
    CREDENCIALES: 'Correo o contraseña incorrectos.',
    BLOQUEADO: 'Demasiados intentos fallidos. Espera 15 minutos.',
    SESION_CADUCADA: 'Tu sesión ha caducado. Vuelve a entrar.',
    SIN_PERMISO: 'Tu usuario no tiene permiso para esto.',
    PASSWORD_CORTA: 'La contraseña debe tener al menos 8 caracteres.',
    ENLACE_NO_VALIDO: 'Este enlace ya no vale (sirve una sola vez y caduca al poco tiempo). Pide otro desde «¿Has olvidado tu contraseña?».',
    CAMBIO_NO_VALIDO: 'Ese cambio de estado no es posible.',
    LINEA_NO_VALIDA: 'Esa línea ya no está en el pedido. Recarga e inténtalo otra vez.',
    FALTAN_DATOS: 'Faltan datos obligatorios.',
    ROL_NO_VALIDO: 'Rol no válido.',
    USUARIO_NO_VALIDO: 'No se encuentra el usuario.',
    ULTIMO_ADMIN: 'Tiene que quedar al menos un administrador activo.',
    FUNCION_NO_ACTIVA: 'Esta opción no está disponible en este local.',
    SIN_PEDIDOS: 'Todavía no hay ningún pedido en esta mesa: no hay cuenta que pedir.',
    NADA_QUE_COBRAR: 'No hay nada servido que cobrar en esta mesa (o ya se ha cobrado).',
    YA_COBRADO: 'Este pedido ya está cobrado. Para cambiarlo, reabre antes su cuenta en «Cuentas de mesas».',
    FUERA_DE_HORARIO: 'Algo de tu pedido no se sirve a esta hora. Mira el horario en la carta.',
    HORARIO_NO_VALIDO: 'Revisa el horario: las horas van como 13:00 y hay que marcar al menos un día.',
    CATEGORIA_NO_VALIDA: 'No se encuentra esa sección de la carta. Recarga la página.',
    MARCA_NO_VALIDA: 'Esa etiqueta no existe.',
    FOTO_NO_VALIDA: 'Esa foto no se ha podido usar. Prueba con otra.',
    ERROR_SERVIDOR: 'Algo ha fallado en el servidor. Inténtalo otra vez en un momento.',
    SLUG_NO_VALIDO: 'La dirección corta solo puede llevar letras minúsculas sin acentos, números y guiones (de 2 a 40), y no puede ser una palabra reservada.',
    SLUG_EN_USO: 'Ya hay un bar con esa dirección corta. Elige otra.',
    MESAS_NO_VALIDAS: 'El número de mesas tiene que estar entre 1 y 200.',
    EMAIL_NO_VALIDO: 'Ese correo no parece válido.',
    OPCION_NO_VALIDA: 'Esa opción no es válida.',
    ASPECTO_NO_VALIDO: 'Algún color, letra o texto no es válido. Revísalo.',
    LOGO_NO_VALIDO: 'Ese logo no se ha podido usar. Prueba con una imagen PNG o JPG.',
    DATOS_NO_VALIDOS: 'Algún dato es demasiado largo o no es válido.',
    DEMASIADOS_INTENTOS: 'Demasiados intentos seguidos. Espera unos minutos y vuelve a probar.',
    MISMA_PASSWORD: 'La contraseña nueva tiene que ser distinta de la actual.',
  };
  return textos[base] || ('Algo ha fallado (' + c + '). Inténtalo otra vez.');
}

/* ---------------- ALMACÉN LOCAL DEL MÓVIL ----------------
   En Safari en modo privado localStorage puede fallar: siempre con try. */
function leerLocal(clave){
  try { const v = localStorage.getItem(clave); return v ? JSON.parse(v) : null; } catch(e) { return null; }
}
function guardarLocal(clave, valor){
  try {
    if(valor === null || valor === undefined) localStorage.removeItem(clave);
    else localStorage.setItem(clave, JSON.stringify(valor));
  } catch(e) { /* sin almacenamiento: se sigue sin recordar */ }
}

/* Número al azar que identifica este móvil (no es un dato personal):
   sirve para que el cliente vea y edite solo sus propios pedidos. */
function dispositivoId(){
  let id = leerLocal('lmdg.dispositivo');
  if(!id){
    if(window.crypto && crypto.randomUUID) id = crypto.randomUUID();
    else {
      const b = crypto.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
      const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
      id = h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
    }
    guardarLocal('lmdg.dispositivo', id);
  }
  return id;
}

/* ---------------- CARTA (cliente de la mesa) ---------------- */
const datosCarta = {
  // { slug, nombre, subtitulo, ajustes: { pie: [líneas del pie de la carta] } }
  bar: () => apiRpc('carta_bar_multibar', { p_bar: BAR }),
  menu: () => apiRpc('carta_menu_multibar', { p_bar: BAR }),
  mesa: (mesa, codigo) => apiRpc('carta_mesa_multibar', { p_bar: BAR, p_mesa: Number(mesa), p_codigo: String(codigo || '') }),
  // lineas: [{ producto: id, cantidad: n, nota: '...' }]
  crearPedido: (mesa, codigo, lineas) => apiRpc('crear_pedido_multibar', {
    p_bar: BAR, p_mesa: Number(mesa), p_codigo: String(codigo || ''), p_dispositivo: dispositivoId(), p_lineas: lineas,
  }),
  // lineas vacías = anular el pedido
  editarPedido: (pedidoId, lineas) => apiRpc('editar_pedido_multibar', {
    p_pedido: pedidoId, p_dispositivo: dispositivoId(), p_lineas: lineas,
  }),
  misPedidos: () => apiRpc('mis_pedidos_multibar', { p_bar: BAR, p_dispositivo: dispositivoId() }),
  // «Llamar al camarero» (tipo 'camarero') o «Pedir la cuenta» ('cuenta'), v15.
  aviso: (mesa, codigo, tipo) => apiRpc('carta_aviso_multibar', { p_bar: BAR, p_mesa: Number(mesa), p_codigo: String(codigo || ''), p_tipo: tipo }),
  // «En tu mesa hoy» (v31): lo pedido hoy por toda la mesa, sin cobrar.
  pedidoMesa: (mesa, codigo) => apiRpc('carta_pedido_mesa_multibar', { p_bar: BAR, p_mesa: Number(mesa), p_codigo: String(codigo || '') }),
  // Cobrar por separado (v34): número de este móvil en la mesa y pedidos hechos al camarero.
  cuenta: (mesa, codigo) => apiRpc('carta_cuenta_multibar', { p_bar: BAR, p_mesa: Number(mesa), p_codigo: String(codigo || ''), p_dispositivo: dispositivoId() }),
};

/* ---------------- LOGIN CON SUPABASE (v35) ----------------
   Desde la v35 el personal y la plataforma entran con el login de Supabase
   (Supabase Auth: más seguro, con freno a ataques). La librería oficial
   (comun/supabase.js, copia dentro de la web: nada se carga de fuera) guarda
   la sesión en el móvil y la renueva sola. La base reconoce a la persona por
   su sesión (auth.uid()) y sigue comprobando bar y rol en cada función.
   Panel y plataforma tienen sesiones aparte (cada una con su clave). Las
   sesiones antiguas con token (web v34) siguen valiendo hasta que caduquen. */
const clientesSupabase = {};
function clienteSupabase(clave){
  if(!clientesSupabase[clave]){
    if(!window.supabase || !window.supabase.createClient) return null;
    clientesSupabase[clave] = window.supabase.createClient(SUPABASE_URL, CLAVE_PUBLICA, {
      auth: { storageKey: clave, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }
  return clientesSupabase[clave];
}
// Sesión de Supabase en vigor (la renueva si hace falta), o null.
async function jwtSupabase(clave){
  const sb = clienteSupabase(clave);
  if(!sb) return null;
  try { const { data } = await sb.auth.getSession(); return data && data.session ? data.session.access_token : null; }
  catch(e) { return null; }
}
// El dictado añade a veces espacios o un punto al final del correo (bases v11).
function limpiarCorreo(email){ return String(email || '').trim().replace(/[\s.]+$/, '').toLowerCase(); }
// Error del login de Supabase → código con texto en español.
function codigoAuth(error){
  const st = Number(error && error.status) || 0;
  if(st === 429) return 'DEMASIADOS_INTENTOS';
  if(st === 0 || st >= 500 || (error && error.name === 'AuthRetryableFetchError')) return 'SIN_CONEXION';
  if(error && (error.code === 'same_password' || /different from the old/i.test(error.message || ''))) return 'MISMA_PASSWORD';
  if(error && (error.code === 'weak_password')) return 'PASSWORD_CORTA';
  return 'CREDENCIALES';
}
// Entrar con Supabase y preguntar a la base quién es (función «yo»). Si la
// cuenta no vale aquí (otro producto, de baja…), se cierra y se dice
// «correo o contraseña incorrectos», sin dar más pistas.
async function entrarSupabase(clave, email, password, funcionYo){
  const sb = clienteSupabase(clave);
  if(!sb) throw new ErrorDatos('SIN_CONEXION');
  let res;
  try { res = await sb.auth.signInWithPassword({ email: limpiarCorreo(email), password: String(password || '') }); }
  catch(e) { throw new ErrorDatos('SIN_CONEXION'); }
  if(res.error || !res.data || !res.data.session) throw new ErrorDatos(codigoAuth(res.error));
  try {
    return await apiRpc(funcionYo, { p_token: null }, res.data.session.access_token);
  } catch(e) {
    try { await sb.auth.signOut({ scope: 'local' }); } catch(x) { /* ya está fuera */ }
    throw new ErrorDatos(e.codigo === 'SESION_CADUCADA' ? 'CREDENCIALES' : (e.codigo || 'ERROR_SERVIDOR'));
  }
}
async function salirSupabase(clave){
  const sb = clienteSupabase(clave);
  if(!sb) return;
  try { await sb.auth.signOut(); } catch(e) { try { await sb.auth.signOut({ scope: 'local' }); } catch(x) { /* ya está fuera */ } }
}

/* ---------------- LOGIN DEL PERSONAL ----------------
   Se guarda en el móvil, además de la sesión de Supabase, el nombre/rol y
   el bar del usuario para pintar el panel. */
const CLAVE_SESION = 'lmdg.sesion';
const AUTH_PANEL = 'mb.auth.panel';

function getSesion(){ return leerLocal(CLAVE_SESION); }
function getAuthTokenPersonal(){ const s = getSesion(); return s ? s.token : null; }

function guardarSesionPanel(r){
  const sesion = { supabase: true, token: null, nombre: r.nombre, rol: r.rol, email: r.email, cambiarPassword: !!r.cambiar_password, bar: r.bar || null };
  guardarLocal(CLAVE_SESION, sesion);
  return sesion;
}
async function login(email, password){
  return guardarSesionPanel(await entrarSupabase(AUTH_PANEL, email, password, 'personal_yo'));
}

async function logout(){
  const s = getSesion();
  guardarLocal(CLAVE_SESION, null);
  if(s && s.supabase){ await salirSupabase(AUTH_PANEL); return; }
  if(s && s.token){ try { await apiRpc('personal_salir', { p_token: s.token }); } catch(e) { /* ya está fuera */ } }
}

// Comprueba con la base que la sesión sigue viva (y refresca nombre/rol).
async function comprobarSesion(){
  const s = getSesion();
  if(!s) return null;
  try {
    let r;
    if(s.supabase){
      const jwt = await jwtSupabase(AUTH_PANEL);
      if(!jwt) throw new ErrorDatos('SESION_CADUCADA');
      r = await apiRpc('personal_yo', { p_token: null }, jwt);
    } else {
      r = await apiRpc('personal_yo', { p_token: s.token });
    }
    const nueva = Object.assign({}, s, { nombre: r.nombre, rol: r.rol, email: r.email, cambiarPassword: !!r.cambiar_password, bar: r.bar || s.bar || null });
    guardarLocal(CLAVE_SESION, nueva);
    return nueva;
  } catch(e) {
    if(e.codigo === 'SESION_CADUCADA') { guardarLocal(CLAVE_SESION, null); return null; }
    throw e;
  }
}

async function cambiarPassword(actual, nueva){
  const s = getSesion();
  if(s && s.supabase){
    // Con Supabase: se comprueba la actual volviendo a entrar y se cambia.
    // La base copia la nueva contraseña sola y quita «debe cambiarla».
    if(String(nueva || '').length < 8) throw new ErrorDatos('PASSWORD_CORTA');
    const sb = clienteSupabase(AUTH_PANEL);
    let res;
    try { res = await sb.auth.signInWithPassword({ email: limpiarCorreo(s.email), password: String(actual || '') }); }
    catch(e) { throw new ErrorDatos('SIN_CONEXION'); }
    if(res.error) throw new ErrorDatos(codigoAuth(res.error));
    try { res = await sb.auth.updateUser({ password: String(nueva) }); }
    catch(e) { throw new ErrorDatos('SIN_CONEXION'); }
    if(res.error) throw new ErrorDatos(codigoAuth(res.error) === 'CREDENCIALES' ? 'ERROR_SERVIDOR' : codigoAuth(res.error));
  } else {
    await apiRpc('personal_cambiar_password', { p_token: getAuthTokenPersonal(), p_actual: actual, p_nueva: nueva });
  }
  const t = getSesion();
  if(t){ t.cambiarPassword = false; guardarLocal(CLAVE_SESION, t); }
}

/* Recuperar la contraseña y bienvenida con Supabase (v36). Supabase manda el
   correo con la imagen del bar (Edge Function común «enviar-correo», de
   AutonomIA-Lab) y su botón abre «destino» con ?token_hash=…&type=recovery.
   Contesta siempre igual, exista o no el correo, para no desvelar quién
   trabaja dónde. */
async function pedirEnlaceSupabase(clave, email, destino){
  const sb = clienteSupabase(clave);
  if(!sb) throw new ErrorDatos('SIN_CONEXION');
  let res;
  try { res = await sb.auth.resetPasswordForEmail(limpiarCorreo(email), { redirectTo: destino }); }
  catch(e) { throw new ErrorDatos('SIN_CONEXION'); }
  if(res.error){
    const c = codigoAuth(res.error);
    throw new ErrorDatos(c === 'CREDENCIALES' ? 'ERROR_SERVIDOR' : c);
  }
}
// Dirección del panel de un bar para el botón del correo (relativa a esta web).
function direccionPanel(slug, bienvenida){
  const u = new URL('../panel/', location.href);
  if(slug) u.searchParams.set('bar', slug);
  if(bienvenida) u.searchParams.set('bienvenida', '1');
  return u.href;
}
// Enlace del correo de Supabase: ?token_hash=…&type=… (y bienvenida=1). Se
// quita de la dirección al leerlo (el resto, como ?bar=, se queda).
function leerEnlaceSupabase(){
  let q;
  try { q = new URLSearchParams(location.search); } catch(e) { return null; }
  const hash = q.get('token_hash');
  if(hash === null) return null;
  const tipo = q.get('type'), bienvenida = q.get('bienvenida') === '1';
  ['token_hash', 'type', 'bienvenida'].forEach((k) => q.delete(k));
  try { history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q.toString() : '')); } catch(e) {}
  return { hash, bienvenida, verificado: false,
    tipo: ['recovery', 'invite', 'magiclink', 'email', 'signup'].includes(tipo) ? tipo : 'recovery' };
}
/* Con el enlace del correo: se comprueba (verifyOtp, abre la sesión), se
   guarda la contraseña nueva (la base la copia sola y quita «debe
   cambiarla») y se cierran las sesiones de los demás aparatos. Devuelve
   { yo, email }: yo = lo que dice la función «yo» de esta web, o null si la
   cuenta no es de aquí (entonces se cierra la sesión: la contraseña ya vale). */
async function restablecerSupabase(clave, enlace, nueva, funcionYo){
  if(String(nueva || '').length < 8) throw new ErrorDatos('PASSWORD_CORTA');
  const sb = clienteSupabase(clave);
  if(!sb) throw new ErrorDatos('SIN_CONEXION');
  let res;
  // El código sirve una vez: si al guardar algo falla, se reintenta sin volver a comprobarlo.
  if(!enlace.verificado){
    try { res = await sb.auth.verifyOtp({ token_hash: enlace.hash, type: enlace.tipo }); }
    catch(e) { throw new ErrorDatos('SIN_CONEXION'); }
    if(res.error || !res.data || !res.data.session){
      const c = codigoAuth(res.error);
      throw new ErrorDatos(c === 'CREDENCIALES' ? 'ENLACE_NO_VALIDO' : c);
    }
    enlace.verificado = true;
  }
  try { res = await sb.auth.updateUser({ password: String(nueva) }); }
  catch(e) { throw new ErrorDatos('SIN_CONEXION'); }
  if(res.error){
    const c = codigoAuth(res.error);
    // Sin sesión (caducó mientras escribía): hace falta otro enlace.
    throw new ErrorDatos(c === 'CREDENCIALES' ? 'ENLACE_NO_VALIDO' : c);
  }
  const email = (res.data && res.data.user && res.data.user.email) || '';
  try { await sb.auth.signOut({ scope: 'others' }); } catch(e) { /* las demás caducan solas */ }
  const jwt = await jwtSupabase(clave);
  try {
    return { yo: await apiRpc(funcionYo, { p_token: null }, jwt), email };
  } catch(e) {
    try { await sb.auth.signOut({ scope: 'local' }); } catch(x) { /* ya está fuera */ }
    return { yo: null, email };
  }
}
// Enlace del correo en el panel: devuelve la sesión del panel o { email } si hay que entrar a mano.
async function restablecerPanel(enlace, nueva){
  const r = await restablecerSupabase(AUTH_PANEL, enlace, nueva, 'personal_yo');
  return r.yo ? guardarSesionPanel(r.yo) : { email: r.email };
}

/* Recuperar la contraseña por correo con la función propia (v18 a v35).
   Desde la v36 solo se usa para los enlaces ya mandados (#recuperar=…). */
async function pedirEnlaceRecuperar(email, bienvenida){
  const corte = window.AbortController ? new AbortController() : null;
  const reloj = corte ? setTimeout(() => corte.abort(), 20000) : null;
  let r;
  try {
    r = await fetch(FUNCIONES_API + '/recuperar-contrasena', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify(bienvenida ? { email: limpiarCorreo(email), bienvenida: true } : { email: limpiarCorreo(email) }),
      signal: corte ? corte.signal : undefined,
    });
  } catch(e) {
    throw new ErrorDatos('SIN_CONEXION');
  } finally { if(reloj) clearTimeout(reloj); }
  if(!r.ok) throw new ErrorDatos('HTTP_' + r.status);
}
/* Fotos de los productos (v26): el panel manda la foto ya recortada y reducida
   a la función del servidor «subir-foto», que comprueba que eres admin del bar
   y la guarda. imagen = "data:image/jpeg;base64,…" o null para quitarla.
   Devuelve la dirección de la foto ('' si se ha quitado). */
async function subirFotoProducto(productoId, imagen){
  const corte = window.AbortController ? new AbortController() : null;
  const reloj = corte ? setTimeout(() => corte.abort(), 45000) : null;
  let r, d = {};
  try {
    const jwt = (getSesion() || {}).supabase ? await jwtSupabase(AUTH_PANEL) : null;
    r = await fetch(FUNCIONES_API + '/subir-foto', {
      method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, jwt ? { 'Authorization': 'Bearer ' + jwt } : {}), cache: 'no-store',
      body: JSON.stringify({ token: getAuthTokenPersonal(), producto: Number(productoId), imagen: imagen || null }),
      signal: corte ? corte.signal : undefined,
    });
    try { d = await r.json(); } catch(e) { d = {}; }
  } catch(e) {
    throw new ErrorDatos('SIN_CONEXION');
  } finally { if(reloj) clearTimeout(reloj); }
  if(!r.ok){
    if(d.codigo === 'SESION_CADUCADA') guardarLocal(CLAVE_SESION, null);
    throw new ErrorDatos(d.codigo || ('HTTP_' + r.status));
  }
  return d.foto || '';
}

// Poner la contraseña nueva con el código de un enlace antiguo (#recuperar=…). Devuelve { email }.
function restablecerPassword(token, nueva){
  return apiRpc('personal_restablecer', { p_token: String(token || ''), p_nueva: nueva });
}

// Llamada del panel con la sesión (de Supabase o, si es de la v34, el token).
// Si caduca, se borra la sesión.
async function rpcPersonal(nombre, params){
  try {
    const s = getSesion();
    if(s && s.supabase){
      const jwt = await jwtSupabase(AUTH_PANEL);
      if(!jwt) throw new ErrorDatos('SESION_CADUCADA');
      return await apiRpc(nombre, Object.assign({ p_token: null }, params || {}), jwt);
    }
    return await apiRpc(nombre, Object.assign({ p_token: getAuthTokenPersonal() }, params || {}));
  } catch(e) {
    if(e.codigo === 'SESION_CADUCADA') guardarLocal(CLAVE_SESION, null);
    throw e;
  }
}

/* ---------------- PANEL (camarero, barra y admin) ---------------- */
const datosPanel = {
  pedidos: (desde) => rpcPersonal('panel_pedidos_multibar', desde ? { p_desde: desde } : {}),
  // Pedidos del día + avisos de las mesas sin atender (v15): { pedidos, avisos }
  estado: () => rpcPersonal('panel_estado_multibar'),
  atenderAviso: (avisoId) => rpcPersonal('panel_atender_aviso_multibar', { p_aviso: avisoId }),
  // Cuentas de las mesas: lo de hoy sin cobrar, mesa por mesa (v15).
  cuentas: () => rpcPersonal('panel_cuentas_multibar'),
  // Cobra SOLO los pedidos servidos que se ven en pantalla (ids), nada más.
  cobrar: (mesa, pedidos) => rpcPersonal('panel_cobrar_multibar', { p_mesa: Number(mesa), p_pedidos: (pedidos || []).map(Number) }),
  cobradas: () => rpcPersonal('panel_cobradas_multibar'),
  reabrirCuenta: (mesa, cuando) => rpcPersonal('panel_reabrir_cuenta_multibar', { p_mesa: Number(mesa), p_cuando: cuando }),
  // estado: 'en_preparacion' (aceptar) | 'servido' | 'enviado' (deshacer a nuevo)
  marcar: (pedidoId, estado) => rpcPersonal('panel_marcar_multibar', { p_pedido: pedidoId, p_estado: estado }),
  // cambios: { lineas: [{ id, cantidad }] } (una línea a 0 queda en el pedido,
  // en gris y a cero euros). La base admite también "nuevas", pero el panel
  // añade productos con un pedido nuevo (crearPedido).
  modificar: (pedidoId, cambios) => rpcPersonal('panel_modificar_pedido_multibar', { p_pedido: pedidoId, p_cambios: cambios }),
  // Pedido nuevo tomado por el camarero (entra como NUEVO, igual que los del cliente).
  // lineas: [{ producto, cantidad, nota }]
  crearPedido: (mesa, lineas) => rpcPersonal('panel_crear_pedido_multibar', { p_mesa: Number(mesa), p_lineas: lineas }),
  mesasPanel: () => rpcPersonal('panel_mesas_multibar'),
  // Control de mesas: abrir (true) o cerrar (false) una mesa para pedidos del QR.
  abrirMesa: (mesa, abrir) => rpcPersonal('panel_abrir_mesa_multibar', { p_mesa: Number(mesa), p_abrir: !!abrir }),
  productos: () => rpcPersonal('panel_productos_multibar'),
  disponible: (productoId, disponible) => rpcPersonal('panel_disponible_multibar', { p_producto: productoId, p_disponible: !!disponible }),
  // Recomendados (v25): 'recomendado' | 'del_dia' | 'nuevo' | '' (quitar).
  marca: (productoId, marca) => rpcPersonal('panel_marca_producto_multibar', { p_producto: productoId, p_marca: marca || '' }),
  // Solo admin:
  // Carta por horario (v25): pestañas con su horario, y guardar el de una.
  horarios: () => rpcPersonal('admin_horarios_multibar'),
  // Fotos (v26): subir (dataURL JPEG) o quitar (null) la foto de un producto.
  subirFoto: (productoId, imagen) => subirFotoProducto(productoId, imagen),
  guardarHorario: (categoria, horario) => rpcPersonal('admin_guardar_horario_multibar', { p_categoria: categoria, p_horario: horario }),
  guardarProducto: (datos) => rpcPersonal('admin_guardar_producto_multibar', { p_datos: datos }),
  usuarios: () => rpcPersonal('admin_usuarios_multibar'),
  guardarUsuario: (datos) => rpcPersonal('admin_guardar_usuario_multibar', { p_datos: datos }),
  mesas: () => rpcPersonal('admin_mesas_multibar'),
  guardarMesa: (datos) => rpcPersonal('admin_guardar_mesa_multibar', { p_datos: datos }),
};

/* =====================================================================
   PLATAFORMA (v27): el panel de autonomIA Lab para administrar MultiBar
   (/plataforma/). Su sesión va aparte de la del panel de un bar (otra
   clave), así un mismo móvil puede tener las dos abiertas.
   ===================================================================== */
const CLAVE_PLATAFORMA = 'mb.plataforma';
const AUTH_PLATAFORMA = 'mb.auth.plataforma';
function getSesionPlataforma(){ return leerLocal(CLAVE_PLATAFORMA); }
async function rpcPlataforma(nombre, params){
  const s = getSesionPlataforma();
  try {
    if(s && s.supabase){
      const jwt = await jwtSupabase(AUTH_PLATAFORMA);
      if(!jwt) throw new ErrorDatos('SESION_CADUCADA');
      return await apiRpc(nombre, Object.assign({ p_token: null }, params || {}), jwt);
    }
    return await apiRpc(nombre, Object.assign({ p_token: s ? s.token : null }, params || {}));
  } catch(e) {
    if(e.codigo === 'SESION_CADUCADA') guardarLocal(CLAVE_PLATAFORMA, null);
    throw e;
  }
}
/* Logo de un bar (v29): el panel de plataforma manda la imagen ya reducida a
   la función del servidor «subir-logo», que comprueba la sesión de plataforma
   y la guarda en la carpeta «logos». Devuelve su dirección (se guarda en el
   bar al guardar el aspecto). */
async function subirLogoPlataforma(barId, imagen){
  const s = getSesionPlataforma();
  const corte = window.AbortController ? new AbortController() : null;
  const reloj = corte ? setTimeout(() => corte.abort(), 45000) : null;
  let r, d = {};
  try {
    const jwt = s && s.supabase ? await jwtSupabase(AUTH_PLATAFORMA) : null;
    r = await fetch(FUNCIONES_API + '/subir-logo', {
      method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, jwt ? { 'Authorization': 'Bearer ' + jwt } : {}), cache: 'no-store',
      body: JSON.stringify({ token: s ? s.token : null, bar: Number(barId), imagen }),
      signal: corte ? corte.signal : undefined,
    });
    try { d = await r.json(); } catch(e) { d = {}; }
  } catch(e) {
    throw new ErrorDatos('SIN_CONEXION');
  } finally { if(reloj) clearTimeout(reloj); }
  if(!r.ok){
    if(d.codigo === 'SESION_CADUCADA') guardarLocal(CLAVE_PLATAFORMA, null);
    throw new ErrorDatos(d.codigo || ('HTTP_' + r.status));
  }
  return d.logo || '';
}
const datosPlataforma = {
  sesion: getSesionPlataforma,
  async entrar(email, password){
    const r = await entrarSupabase(AUTH_PLATAFORMA, email, password, 'plataforma_yo');
    const s = { supabase: true, token: null, nombre: r.nombre, email: r.email };
    guardarLocal(CLAVE_PLATAFORMA, s);
    return s;
  },
  // Con el enlace del correo (v36): devuelve la sesión o { email } si hay que entrar a mano.
  async restablecerConEnlace(enlace, nueva){
    const r = await restablecerSupabase(AUTH_PLATAFORMA, enlace, nueva, 'plataforma_yo');
    if(!r.yo) return { email: r.email };
    const s = { supabase: true, token: null, nombre: r.yo.nombre, email: r.yo.email };
    guardarLocal(CLAVE_PLATAFORMA, s);
    return s;
  },
  async salir(){
    const s = getSesionPlataforma();
    guardarLocal(CLAVE_PLATAFORMA, null);
    if(s && s.supabase){ await salirSupabase(AUTH_PLATAFORMA); return; }
    if(s){ try { await apiRpc('personal_salir', { p_token: s.token }); } catch(e) { /* ya está fuera */ } }
  },
  yo: () => rpcPlataforma('plataforma_yo'),
  bares: () => rpcPlataforma('plataforma_bares_multibar'),
  bar: (id) => rpcPlataforma('plataforma_bar_multibar', { p_bar: Number(id) }),
  opciones: (id, opciones) => rpcPlataforma('plataforma_opciones_multibar', { p_bar: Number(id), p_opciones: opciones }),
  estado: (id, activo) => rpcPlataforma('plataforma_estado_bar_multibar', { p_bar: Number(id), p_activo: !!activo }),
  alta: (datos) => rpcPlataforma('plataforma_alta_bar_multibar', { p_datos: datos }),
  // Entrega 2 (v29): aspecto, datos del bar y personal.
  aspecto: (id, aspecto) => rpcPlataforma('plataforma_aspecto_multibar', { p_bar: Number(id), p_aspecto: aspecto }),
  datosBar: (id, datos) => rpcPlataforma('plataforma_datos_bar_multibar', { p_bar: Number(id), p_datos: datos }),
  usuario: (id, datos) => rpcPlataforma('plataforma_usuario_multibar', { p_bar: Number(id), p_datos: datos }),
  subirLogo: (id, imagen) => subirLogoPlataforma(id, imagen),
  // Correos (los manda Supabase con la imagen del bar; contesta siempre igual, v36).
  // Contraseña de la cuenta de plataforma: el botón vuelve a esta página.
  recuperarPropia: (email) => pedirEnlaceSupabase(AUTH_PLATAFORMA, email, location.href.split(/[?#]/)[0]),
  // Personal de un bar: el botón abre el panel de su bar.
  enlaceContrasena: (email, slug) => pedirEnlaceSupabase(AUTH_PLATAFORMA, email, direccionPanel(slug)),
  bienvenida: (email, slug) => pedirEnlaceSupabase(AUTH_PLATAFORMA, email, direccionPanel(slug, true)),
  // Enlaces antiguos (#recuperar=…, mandados con la v35 o antes).
  restablecer: (token, nueva) => restablecerPassword(token, nueva),
};
