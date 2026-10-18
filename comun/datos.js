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
const DATA_API = 'https://dorunbacwnkwdatfscri.supabase.co/rest/v1';
const CLAVE_PUBLICA = 'sb_publishable_PK12CcvGBEZsFT9lsLpSIA_IsP-v8iS';
// Pequeños programas del servidor de Supabase (Edge Functions): hoy solo
// «recuperar-contrasena», que manda el correo para recuperar la contraseña.
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
   pública de Supabase. */
async function apiRpc(nombre, params){
  // Con mala cobertura una llamada puede quedarse colgada: se corta a los 20 s.
  const corte = window.AbortController ? new AbortController() : null;
  const reloj = corte ? setTimeout(() => corte.abort(), 20000) : null;
  let res;
  try {
    const r = await fetch(DATA_API + '/rpc/' + nombre, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': CLAVE_PUBLICA },
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
    ENLACE_NO_VALIDO: 'Este enlace ya no vale (caduca a los 30 minutos y sirve una sola vez). Pide otro desde «¿Has olvidado tu contraseña?».',
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
};

/* ---------------- LOGIN DEL PERSONAL ----------------
   El login es propio de la base (sin cookies), para que funcione igual en
   iPhone (Safari) y Android. Se guarda en el móvil solo el token de la
   sesión (dura 16 h), el nombre/rol y el bar del usuario para pintar el panel. */
const CLAVE_SESION = 'lmdg.sesion';

function getSesion(){ return leerLocal(CLAVE_SESION); }
function getAuthTokenPersonal(){ const s = getSesion(); return s ? s.token : null; }

async function login(email, password){
  const r = await apiRpc('personal_entrar', { p_email: email, p_password: password });
  if(!r || r.error) throw new ErrorDatos((r && r.error) || 'CREDENCIALES');
  const sesion = { token: r.token, nombre: r.nombre, rol: r.rol, email: r.email, cambiarPassword: !!r.cambiar_password, bar: r.bar || null };
  guardarLocal(CLAVE_SESION, sesion);
  return sesion;
}

async function logout(){
  const token = getAuthTokenPersonal();
  guardarLocal(CLAVE_SESION, null);
  if(token){ try { await apiRpc('personal_salir', { p_token: token }); } catch(e) { /* ya está fuera */ } }
}

// Comprueba con la base que la sesión sigue viva (y refresca nombre/rol).
async function comprobarSesion(){
  const s = getSesion();
  if(!s) return null;
  try {
    const r = await apiRpc('personal_yo', { p_token: s.token });
    const nueva = Object.assign({}, s, { nombre: r.nombre, rol: r.rol, email: r.email, cambiarPassword: !!r.cambiar_password, bar: r.bar || s.bar || null });
    guardarLocal(CLAVE_SESION, nueva);
    return nueva;
  } catch(e) {
    if(e.codigo === 'SESION_CADUCADA') { guardarLocal(CLAVE_SESION, null); return null; }
    throw e;
  }
}

async function cambiarPassword(actual, nueva){
  await apiRpc('personal_cambiar_password', { p_token: getAuthTokenPersonal(), p_actual: actual, p_nueva: nueva });
  const s = getSesion();
  if(s){ s.cambiarPassword = false; guardarLocal(CLAVE_SESION, s); }
}

/* Recuperar la contraseña por correo (v18). El servidor contesta siempre
   lo mismo, exista o no el correo, para no desvelar quién trabaja dónde. */
async function pedirEnlaceRecuperar(email, bienvenida){
  const corte = window.AbortController ? new AbortController() : null;
  const reloj = corte ? setTimeout(() => corte.abort(), 20000) : null;
  let r;
  try {
    r = await fetch(FUNCIONES_API + '/recuperar-contrasena', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify(bienvenida ? { email: String(email || '').trim(), bienvenida: true } : { email: String(email || '').trim() }),
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
    r = await fetch(FUNCIONES_API + '/subir-foto', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
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

// Poner la contraseña nueva con el código del enlace del correo. Devuelve { email }.
function restablecerPassword(token, nueva){
  return apiRpc('personal_restablecer', { p_token: String(token || ''), p_nueva: nueva });
}

// Llamada del panel con el token de la sesión. Si caduca, se borra la sesión.
async function rpcPersonal(nombre, params){
  try {
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
function getSesionPlataforma(){ return leerLocal(CLAVE_PLATAFORMA); }
async function rpcPlataforma(nombre, params){
  const s = getSesionPlataforma();
  try {
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
    r = await fetch(FUNCIONES_API + '/subir-logo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
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
    const r = await apiRpc('plataforma_entrar', { p_email: email, p_password: password });
    if(!r || r.error) throw new ErrorDatos((r && r.error) || 'CREDENCIALES');
    const s = { token: r.token, nombre: r.nombre, email: r.email };
    guardarLocal(CLAVE_PLATAFORMA, s);
    return s;
  },
  async salir(){
    const s = getSesionPlataforma();
    guardarLocal(CLAVE_PLATAFORMA, null);
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
  // Correos (los manda el servidor; contesta siempre igual):
  enlaceContrasena: (email) => pedirEnlaceRecuperar(email),
  bienvenida: (email) => pedirEnlaceRecuperar(email, true),
  restablecer: (token, nueva) => restablecerPassword(token, nueva),
};
