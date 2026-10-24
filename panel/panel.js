/* =====================================================================
   PANEL DE BARRA · MultiBar · diseño v8
   Cada usuario es de un bar: el nombre del bar (cabecera, título,
   "Nuevo pedido") sale de su sesión; en la pantalla de entrar, del bar
   del enlace (/panel/?bar=…) o del bar por defecto.
   Todo el acceso a la base pasa por comun/datos.js (login, datosPanel,
   datosCarta). Aquí solo se pinta la pantalla y se reacciona a los toques.

   Estados de un pedido (iguales que en la base):
     enviado        → NUEVO (rojo)
     en_preparacion → EN PREPARACIÓN (naranja suave). Lo acepta el
                      personal o pasa solo a los 3 minutos (auto).
     servido        → SERVIDO (gris)
   ===================================================================== */

const CADA_MS = 4000;            // consulta de pedidos en vivo
const ROLES = { camarero: 'Camarero', barra: 'Barra', admin: 'Administrador' };
const TAMANOS = ['Tapa', 'Plato', 'Copa', 'Botella'];

// Vistas del menú y quién las ve.
const VISTAS = {
  pedidos:  { nombre: 'Pedidos',          cab: 'PEDIDOS',          roles: ['camarero', 'barra', 'admin'], icono: 'M7 4h10v16H7zM9.5 8h5M9.5 12h5M9.5 16h3' },
  // Solo si el bar tiene encendida la opción (ajustes.cuentas_mesa / ajustes.control_mesas).
  cuentas:  { nombre: 'Cuentas de mesas', cab: 'CUENTAS',          roles: ['camarero', 'barra', 'admin'], icono: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h4', opcion: 'cuentas_mesa' },
  abrir:    { nombre: 'Abrir mesas',      cab: 'ABRIR MESAS',      roles: ['camarero', 'barra', 'admin'], icono: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3', opcion: 'control_mesas' },
  precios:  { nombre: 'Lista de precios', cab: 'LISTA DE PRECIOS', roles: ['barra', 'admin'],             icono: 'M4 6h16M4 12h16M4 18h10M18 16v4' },
  // Carta por horario (v25, opción ajustes.horarios).
  horarios: { nombre: 'Horarios de la carta', cab: 'HORARIOS',     roles: ['admin'],                      icono: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', opcion: 'horarios' },
  resumen:  { nombre: 'Resumen del día',  cab: 'RESUMEN DEL DÍA',  roles: ['barra', 'admin'],             icono: 'M5 20V11M12 20V5M19 20v-7' },
  mesas:    { nombre: 'Mesas',            cab: 'MESAS',            roles: ['admin'],                      icono: 'M4 9h16M6 9v10M18 9v10M9 5h6' },
  usuarios: { nombre: 'Usuarios',         cab: 'USUARIOS',         roles: ['admin'],                      icono: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c1.5-4 4.5-5 8-5s6.5 1 8 5' },
};

const estado = {
  sesion: null,
  vista: 'pedidos',
  pedidos: [],
  avisos: [],              // avisos de las mesas sin atender (v15)
  avisosVistos: null,      // ids de avisos ya avisados
  cuentas: [],             // cuentas de las mesas sin cobrar (v15)
  cobradas: [],            // cuentas cobradas hoy, para poder reabrir (v16)
  destino: leerLocal('panel.destino') || 'todo', // qué ve este aparato: todo | barra | cocina
  vistos: null,            // ids de pedidos nuevos ya avisados
  modificados: {},         // id -> fecha de la última edición del cliente
  ocupado: new Set(),      // pedidos con un botón en marcha
  productos: [],
  categorias: [],
  cambios: {},             // precios cambiados sin guardar: id -> precio
  usuarios: [],
  mesas: [],
  menuCarta: null,         // carta (para añadir productos al modificar)
  alTocarModal: null,
  temporizador: null,
  sonidoActivo: false,
  ultimaCarga: null,
  sinConexion: false,
};

const $ = (id) => document.getElementById(id);

/* ---------------- EL BAR ---------------- */
let NOMBRE_BAR = '';
function pintarBar(info){
  if(!info || !info.nombre) return;
  NOMBRE_BAR = String(info.nombre);
  // Colores, fuentes y logo del bar (comun/aspecto.js); el diseño del panel es el mismo para todos.
  Aspecto.aplicar(info, { panel: true });
  $('cLocal').textContent = NOMBRE_BAR;
  $('nvLocal').textContent = NOMBRE_BAR.toUpperCase();
  $('lLocal').textContent = NOMBRE_BAR;
  const conLegal = !!(info.ajustes && info.ajustes.legal && info.ajustes.legal.titular);
  $('lLegal').hidden = $('lLegalSep').hidden = !conLegal;
  $('lLegal').href = '../legal/?bar=' + encodeURIComponent(info.slug || BAR) + '#privacidad';
  document.title = NOMBRE_BAR + ' · Panel';
  guardarLocal('panel.ultimoBar', { slug: info.slug || BAR, nombre: NOMBRE_BAR, ajustes: info.ajustes || {} });
}
// Antes de entrar: el bar del enlace (lo último que se supo, y luego la base).
async function pintarBarDelEnlace(){
  if(!BAR){
    // Sin ?bar=… (p. ej. el panel instalado como aplicación): el nombre del
    // último bar que se usó en este aparato; si no hay, entrada neutra.
    const u = leerLocal('panel.ultimoBar');
    if(u && u.nombre) pintarBar(u);
    return;
  }
  pintarBar(leerLocal('bar.' + BAR));
  try { const info = await datosCarta.bar(); guardarLocal('bar.' + BAR, info); if(!estado.sesion) pintarBar(info); }
  catch(e) {
    // Sin conexión con la base: copia de reserva del bar (si no se sabía ya).
    if(NOMBRE_BAR) return;
    try { const r = await fetch('../datos/bares/' + BAR + '/bar.json', { cache: 'no-cache' }); if(r.ok && !estado.sesion) pintarBar(await r.json()); }
    catch(e2) { /* sin reserva */ }
  }
}

/* Escapar texto antes de meterlo en la página (las notas las escribe
   el cliente: nunca se pintan como HTML). */
function esc(t){
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// Importes al estilo español: 1.234,50 € (con espacio antes del símbolo).
const FORMATO_EUROS = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, useGrouping: true });
function euros(n){ return FORMATO_EUROS.format(Number(n || 0)); }
// "viernes, 10 de octubre" → "Viernes, 10 de octubre"
function fechaLarga(d){
  const t = (d || new Date()).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function hora(f){ return new Date(f).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }); }
function minutosDesde(f){ return Math.max(0, Math.floor((Date.now() - new Date(f).getTime()) / 60000)); }
function textoEspera(min){
  if(min < 1) return 'ahora mismo';
  if(min < 60) return 'hace ' + min + ' min';
  return 'hace ' + Math.floor(min / 60) + ' h ' + String(min % 60).padStart(2, '0') + ' min';
}
function inicioDeHoy(){ const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
function deHoy(p){ return new Date(p.creado).getTime() >= inicioDeHoy(); }

let toastT = null;
function toast(texto, error){
  const t = $('toast');
  t.textContent = texto; t.className = 'toast' + (error ? ' error' : ''); t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, error ? 4500 : 2200);
}

/* ---------------- PANTALLAS ---------------- */
function mostrar(vista){
  ['vLogin', 'vOlvido', 'vNueva', 'vPass', 'vOtroBar', 'vPanel'].forEach(v => { $(v).hidden = (v !== vista); });
  $('cVivo').hidden = vista !== 'vPanel';
  if(vista === 'vLogin' || vista === 'vOtroBar') $('cVista').textContent = 'PANEL DE BARRA';
  if(vista === 'vPass' || vista === 'vOlvido' || vista === 'vNueva') $('cVista').textContent = 'TU CONTRASEÑA';
  window.scrollTo(0, 0);
}

async function arrancar(){
  // Enlace del correo de Supabase (v36): /panel/?bar=…&token_hash=…&type=recovery.
  const enlace = leerEnlaceSupabase();
  if(enlace){
    estado.enlace = enlace;
    $('nTitulo').textContent = enlace.bienvenida ? 'ELIGE TU CONTRASEÑA' : 'CONTRASEÑA NUEVA';
    $('nError').hidden = true;
    mostrar('vNueva');
    return;
  }
  let s = getSesion();
  if(s){
    try { s = await comprobarSesion(); }
    catch(e) { /* sin conexión: se sigue con la sesión guardada */ }
  }
  if(!s) return mostrar('vLogin');
  // El enlace es de otro bar que el de la sesión (p. ej. «Abrir panel» desde
  // la plataforma): se pregunta antes de abrir el de la sesión (v28).
  if(BAR_ENLACE && s.bar && s.bar.slug && s.bar.slug !== BAR_ENLACE){
    estado.sesionOtroBar = s;
    const enlace = (leerLocal('bar.' + BAR_ENLACE) || {}).nombre || BAR_ENLACE;
    $('obEnlace').textContent = $('obEnlace2').textContent = enlace;
    datosCarta.bar().then((i) => { if(i && i.nombre) $('obEnlace').textContent = $('obEnlace2').textContent = i.nombre; }).catch(() => {});
    $('obSesion').textContent = $('obSesion2').textContent = s.bar.nombre || s.bar.slug;
    $('obUsuario').textContent = s.nombre + ' · ' + (ROLES[s.rol] || s.rol);
    return mostrar('vOtroBar');
  }
  entrarConSesion(s);
}
// El bar del enlace (/panel/?bar=…), antes de que la sesión lo cambie.
const BAR_ENLACE = BAR;

function entrarConSesion(s){
  estado.sesion = s;
  if(s.bar){ usarBar(s.bar.slug); pintarBar(s.bar); }
  if(s.cambiarPassword){ mostrar('vPass'); return; }
  $('menuUsuario').textContent = s.nombre + ' · ' + (ROLES[s.rol] || s.rol);
  pintarMenu();
  mostrar('vPanel');
  irA('pedidos');
  cargarPedidos();
  clearInterval(estado.temporizador);
  estado.temporizador = setInterval(cargarPedidos, CADA_MS);
}

function volverAlLogin(mensaje){
  clearInterval(estado.temporizador);
  cerrarNuevo();
  cerrarMenu();
  estado.sesion = null; estado.pedidos = []; estado.vistos = null; estado.cambios = {};
  // Lo de la carta se vuelve a leer al entrar (el siguiente usuario puede ser de otro bar).
  estado.categorias = []; estado.menuCarta = null; estado.productos = []; estado.mesas = []; estado.usuarios = []; estado.mesasAbrir = null;
  $('lPass').value = '';
  mostrar('vLogin');
  if(mensaje){ $('lError').textContent = mensaje; $('lError').hidden = false; }
}

// Errores comunes: sesión caducada → al login; lo demás, aviso.
function tratarError(e){
  if(e && e.codigo === 'SESION_CADUCADA'){ volverAlLogin(e.message); return; }
  toast((e && e.message) || 'Algo ha fallado.', true);
}

/* ---------------- LOGIN ---------------- */
$('fLogin').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const email = $('lEmail').value.trim(), pass = $('lPass').value;
  $('lError').hidden = true;
  if(!email || !pass){ $('lError').textContent = 'Escribe tu correo y tu contraseña.'; $('lError').hidden = false; return; }
  $('lBoton').disabled = true; $('lBoton').textContent = 'Entrando…';
  try {
    const s = await login(email, pass);
    $('lPass').value = '';
    if(s.cambiarPassword) $('pActual').value = pass;
    entrarConSesion(s);
  } catch(e) {
    $('lError').textContent = e.message; $('lError').hidden = false;
  } finally {
    $('lBoton').disabled = false; $('lBoton').textContent = 'Entrar';
  }
});

$('fPass').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const actual = $('pActual').value, nueva = $('pNueva').value, rep = $('pRepite').value;
  const err = (t) => { $('pError').textContent = t; $('pError').hidden = false; };
  $('pError').hidden = true;
  if(nueva.length < 8) return err('La contraseña nueva debe tener al menos 8 caracteres.');
  if(nueva !== rep) return err('Las dos contraseñas nuevas no coinciden.');
  if(nueva === actual) return err('La nueva tiene que ser distinta de la actual.');
  try {
    await cambiarPassword(actual, nueva);
    ['pActual', 'pNueva', 'pRepite'].forEach(id => { $(id).value = ''; });
    toast('Contraseña cambiada');
    entrarConSesion(getSesion());
  } catch(e) {
    if(e.codigo === 'SESION_CADUCADA') return volverAlLogin(e.message);
    err(e.codigo === 'CREDENCIALES' ? 'La contraseña actual no es correcta.' : e.message);
  }
});

/* ---------------- HE OLVIDADO MI CONTRASEÑA (v18) ---------------- */
$('lOlvido').addEventListener('click', () => {
  $('oEmail').value = $('lEmail').value.trim();
  $('oError').hidden = true; $('oPedir').hidden = false; $('oHecho').hidden = true;
  mostrar('vOlvido');
});
$('fOlvido').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const email = $('oEmail').value.trim();
  $('oError').hidden = true;
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ $('oError').textContent = 'Escribe bien tu correo.'; $('oError').hidden = false; return; }
  $('oBoton').disabled = true; $('oBoton').textContent = 'Enviando…';
  try {
    await pedirEnlaceSupabase(AUTH_PANEL, email, direccionPanel(BAR_ENLACE));
    $('oPedir').hidden = true; $('oHecho').hidden = false;
  } catch(e) {
    $('oError').textContent = (e.codigo === 'SIN_CONEXION' || e.codigo === 'DEMASIADOS_INTENTOS') ? e.message : 'No se ha podido enviar ahora. Inténtalo dentro de un rato o pídesela al encargado.';
    $('oError').hidden = false;
  } finally {
    $('oBoton').disabled = false; $('oBoton').textContent = 'Enviarme el enlace';
  }
});
$('fNueva').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const nueva = $('nNueva').value, rep = $('nRepite').value;
  const err = (t) => { $('nError').textContent = t; $('nError').hidden = false; };
  $('nError').hidden = true;
  if(!estado.enlace) return err(textoError('ENLACE_NO_VALIDO'));
  if(nueva.length < 8) return err('La contraseña nueva debe tener al menos 8 caracteres.');
  if(nueva !== rep) return err('Las dos contraseñas no coinciden.');
  $('nBoton').disabled = true; $('nBoton').textContent = 'Guardando…';
  try {
    const r = await restablecerPanel(estado.enlace, nueva);
    estado.enlace = null;
    ['nNueva', 'nRepite'].forEach(id => { $(id).value = ''; });
    toast('Contraseña guardada');
    if(r.rol){ entrarConSesion(r); return; }
    // La cuenta no es de un bar (p. ej. la de plataforma): la contraseña ya vale, se entra a mano.
    guardarLocal(CLAVE_SESION, null);
    $('lEmail').value = r.email || ''; $('lPass').value = ''; $('lError').hidden = true;
    mostrar('vLogin');
  } catch(e) {
    err(e.message);
  } finally {
    $('nBoton').disabled = false; $('nBoton').textContent = 'Guardar contraseña';
  }
});
function volverDeRecuperar(){ estado.enlace = null; arrancar(); }
$('oVolver').addEventListener('click', volverDeRecuperar);
$('nVolver').addEventListener('click', volverDeRecuperar);

async function salir(){
  await logout();
  volverAlLogin();
}
$('pSalir').addEventListener('click', salir);
// Otro bar (v28): salir y entrar en el del enlace, o seguir en el de la sesión
// (la dirección pasa a ser la de su bar, para no volver a preguntar al recargar).
$('obSalir').addEventListener('click', async () => {
  estado.sesionOtroBar = null;
  await logout();
  volverAlLogin();
  pintarBarDelEnlace();
});
$('obSeguir').addEventListener('click', () => {
  const s = estado.sesionOtroBar; estado.sesionOtroBar = null;
  try { history.replaceState(null, '', location.pathname + '?bar=' + encodeURIComponent(s.bar.slug)); } catch(e) {}
  entrarConSesion(s);
});
$('bSalir').addEventListener('click', salir);

/* ---------------- MENÚ DE ABAJO ---------------- */
// Opciones de la plataforma encendidas en el bar de la sesión (ajustes del bar).
function opcionBar(k){ const b = estado.sesion && estado.sesion.bar; return !!(b && b.ajustes && b.ajustes[k]); }
function controlMesas(){ return opcionBar('control_mesas'); }
function vistasDelRol(rol){ return Object.keys(VISTAS).filter(v => VISTAS[v].roles.includes(rol) && (!VISTAS[v].opcion || opcionBar(VISTAS[v].opcion))); }

function pintarMenu(){
  const nuevos = estado.pedidos.filter(p => p.estado === 'enviado').length;
  $('menuVistas').innerHTML = vistasDelRol(estado.sesion.rol).map(v => `
    <button class="menu-item ${estado.vista === v ? 'activo' : ''}" type="button" data-vista="${v}">
      <svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${VISTAS[v].icono}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
      ${esc(VISTAS[v].nombre)}
      ${v === 'pedidos' && nuevos ? `<span class="cuenta">${nuevos} nuevo${nuevos === 1 ? '' : 's'}</span>` : ''}
    </button>`).join('');
}
function abrirMenu(){
  pintarMenu();
  $('velo').classList.add('ver'); $('hojaMenu').classList.add('ver');
  $('abrirMenu').setAttribute('aria-expanded', 'true');
}
function cerrarMenu(){
  $('velo').classList.remove('ver'); $('hojaMenu').classList.remove('ver');
  $('abrirMenu').setAttribute('aria-expanded', 'false');
}
$('abrirMenu').addEventListener('click', abrirMenu);
$('velo').addEventListener('click', cerrarMenu);
$('menuVistas').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-vista]');
  if(!b) return;
  cerrarMenu();
  irA(b.dataset.vista);
});

function irA(vista){
  if(!vistasDelRol(estado.sesion.rol).includes(vista)) vista = 'pedidos';
  estado.vista = vista;
  $('cVista').textContent = VISTAS[vista].cab;
  $('sPedidos').hidden = vista !== 'pedidos';
  $('sCuentas').hidden = vista !== 'cuentas';
  $('sAbrir').hidden = vista !== 'abrir';
  $('sPrecios').hidden = vista !== 'precios';
  $('sHorarios').hidden = vista !== 'horarios';
  $('sResumen').hidden = vista !== 'resumen';
  $('sMesas').hidden = vista !== 'mesas';
  $('sUsuarios').hidden = vista !== 'usuarios';
  window.scrollTo(0, 0);
  if(vista === 'pedidos') pintarPedidos();
  if(vista === 'cuentas') cargarCuentas();
  if(vista === 'abrir') cargarAbrir();
  if(vista === 'precios') cargarProductos();
  if(vista === 'horarios') cargarHorarios();
  if(vista === 'resumen') pintarResumen();
  if(vista === 'mesas') cargarMesas();
  if(vista === 'usuarios') cargarUsuarios();
}

/* ---------------- LÍNEA "EN LÍNEA" DE LA CABECERA ---------------- */
function pintarVivo(){
  const v = $('cVivo');
  v.className = 'cab-vivo ' + (estado.sinConexion ? 'mal' : estado.ultimaCarga ? 'ok' : '');
  let t = estado.sinConexion ? 'sin conexión · reintentando…'
        : estado.ultimaCarga ? fechaLarga() + ' · en línea ' + estado.ultimaCarga.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
        : 'conectando…';
  $('cVivoTxt').innerHTML = esc(t) + (estado.sonidoActivo ? '' : ' · <b>toca la pantalla para activar el sonido</b>');
}

/* =====================================================================
   PEDIDOS EN VIVO
   ===================================================================== */
let cargando = false;
async function cargarPedidos(){
  if(cargando || !estado.sesion) return;
  cargando = true;
  try {
    // Pedidos del día y avisos de las mesas, en una sola llamada (v15).
    const r = await datosPanel.estado();
    estado.pedidos = (r && Array.isArray(r.pedidos)) ? r.pedidos : [];
    estado.avisos = (r && Array.isArray(r.avisos)) ? r.avisos : [];
    estado.ultimaCarga = new Date(); estado.sinConexion = false;
    detectarNovedades();
    detectarAvisos();
    pintarAvisos();
    if(estado.vista === 'pedidos') pintarPedidos();
    if(estado.vista === 'resumen') pintarResumen();
    if(estado.vista === 'cuentas') cargarCuentas();
  } catch(e) {
    if(e.codigo === 'SESION_CADUCADA') return volverAlLogin(e.message);
    estado.sinConexion = true;
  } finally {
    cargando = false;
    pintarVivo();
  }
}

// Avisa (sonido, vibración y destello) de pedidos nuevos o editados.
function detectarNovedades(){
  // Con barra y cocina separadas, cada aparato solo suena con lo suyo.
  const nuevos = estado.pedidos.filter(p => p.estado === 'enviado' && delFiltro(p));
  if(estado.vistos === null){
    // Primera carga: lo que ya había no suena.
    estado.vistos = new Set(nuevos.map(p => p.id));
    estado.pedidos.forEach(p => { estado.modificados[p.id] = p.modificado; });
    return;
  }
  let hayNuevo = false, hayEditado = false;
  nuevos.forEach(p => { if(!estado.vistos.has(p.id)){ estado.vistos.add(p.id); hayNuevo = true; } });
  estado.pedidos.forEach(p => {
    if(p.modificado && estado.modificados[p.id] !== p.modificado && p.estado !== 'servido' && delFiltro(p)) hayEditado = true;
    estado.modificados[p.id] = p.modificado;
  });
  if(hayNuevo) avisar('nuevo');
  else if(hayEditado) avisar('editado');
}

const porCreacion = (a, b) => new Date(a.creado) - new Date(b.creado);

/* ---------------- BARRA Y COCINA (v15, opción barra_cocina) ----------------
   Un pedido con bebida y comida llega en dos partes (mismo número), cada
   una con su estado. Cada aparato elige qué ver: todo, solo barra o solo
   cocina (se recuerda en ese aparato). */
function separaDestinos(){ return opcionBar('barra_cocina'); }
function delFiltro(p){
  if(!separaDestinos() || estado.destino === 'todo' || !p.destino) return true;
  return p.destino === estado.destino;
}
function pintarFiltro(){
  const f = $('filtroDestino');
  f.hidden = !separaDestinos();
  f.querySelectorAll('button').forEach(b => b.classList.toggle('activo', b.dataset.destino === estado.destino));
}
$('filtroDestino').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-destino]');
  if(!b) return;
  estado.destino = b.dataset.destino;
  guardarLocal('panel.destino', estado.destino);
  // Lo que ya estaba pendiente no debe sonar al cambiar de filtro.
  estado.pedidos.filter(p => p.estado === 'enviado').forEach(p => estado.vistos && estado.vistos.add(p.id));
  pintarPedidos();
});

function pintarPedidos(){
  pintarFiltro();
  const ps = estado.pedidos.filter(delFiltro);
  const nuevos = ps.filter(p => p.estado === 'enviado').sort(porCreacion);
  const prep = ps.filter(p => p.estado === 'en_preparacion').sort(porCreacion);
  const servidos = ps.filter(p => p.estado === 'servido').sort((a, b) => new Date(b.servido || b.creado) - new Date(a.servido || a.creado));

  $('nPendientes').textContent = nuevos.length + prep.length;
  $('nServidos').textContent = servidos.filter(deHoy).length;
  $('nTotalHoy').textContent = euros(estado.pedidos.filter(deHoy).reduce((s, p) => s + Number(p.total || 0), 0));
  document.title = (nuevos.length ? '(' + nuevos.length + ') ' : '') + (NOMBRE_BAR ? NOMBRE_BAR + ' · ' : '') + 'Panel';

  const pendientes = nuevos.concat(prep);
  $('listaPendientes').innerHTML = pendientes.length ? pendientes.map(tarjeta).join('') : '<div class="vacio">Todo al día: no hay pedidos pendientes.</div>';
  $('listaServidos').innerHTML = servidos.length ? servidos.map(tarjeta).join('') : '<div class="vacio">Todavía no se ha servido ningún pedido hoy.</div>';
}

function tarjeta(p){
  const servido = p.estado === 'servido';
  const min = minutosDesde(p.creado);
  const ocupado = estado.ocupado.has(p.id) ? 'disabled' : '';

  // Una línea a 0 la ha quitado el personal: se ve en gris clarito y a cero.
  const lineas = (p.lineas || []).map(l => `
    <div class="linea ${l.cantidad === 0 ? 'cero' : ''}"><span class="cant">${l.cantidad}×</span><span class="nombre">${esc(l.nombre)}</span><span class="puntos"></span><span class="precio">${euros(l.precio * l.cantidad)}</span></div>
    ${l.nota && l.cantidad > 0 ? `<div class="nota"><span class="aviso">⚠</span> ${esc(l.nota)}</div>` : ''}`).join('');

  // Sin etiquetas: el estado se ve por el color de la tarjeta y por el botón
  // principal (Aceptar pedido / Marcar como servido).

  let pie = '';
  if(p.estado === 'enviado'){
    pie = `<div class="t-botones">
      <button class="btn btn-rosa" data-accion="en_preparacion" data-id="${p.id}" ${ocupado}>Aceptar pedido</button>
      <button class="btn btn-borde" data-accion="servido" data-id="${p.id}" ${ocupado}>Servido</button></div>`;
  } else if(p.estado === 'en_preparacion'){
    pie = `<div class="t-botones">
      <button class="btn btn-azul" data-accion="servido" data-id="${p.id}" ${ocupado}>Marcar como servido</button>
      <button class="btn btn-borde ajustado" data-accion="enviado" data-id="${p.id}" ${ocupado}>Deshacer</button></div>`;
  } else {
    // Cobrado (v16): ya no se puede deshacer ni modificar (antes hay que reabrir la cuenta).
    pie = `<div class="t-servido">
      <span class="marca">✓ Servido${p.servido ? ' ' + hora(p.servido) : ''}${p.servido_por ? ' · ' + esc(p.servido_por) : ''}${p.cobrado ? ' · Cobrado' : ''}</span>
      ${p.cobrado ? '' : `<button class="btn btn-peq" data-accion="en_preparacion" data-id="${p.id}" ${ocupado}>Deshacer</button>`}</div>`;
  }
  pie += `<div class="t-enlaces">
      ${p.cobrado ? '<span></span>' : `<button class="btn-modificar" type="button" data-modificar="${p.id}" ${ocupado}>✎ Modificar pedido</button>`}
      <button class="btn-modificar" type="button" data-nuevo-mesa="${p.mesa}">+ Nuevo pedido</button></div>`;

  const clase = { enviado: 'nuevo', en_preparacion: 'prep', servido: 'servido' }[p.estado] || '';
  return `<div class="pedido ${servido ? 'servido' : ''}">
    <div class="tarjeta ${clase}">
      <div class="pedido-num">Pedido nº ${esc(p.numero || p.id)}${p.destino ? `<span class="destino-etq ${p.destino === 'barra' ? 'barra' : 'cocina'}">${p.destino === 'barra' ? 'Barra' : 'Cocina'}</span>` : ''}</div>
      <div class="t-arriba"><span class="t-mesa">${esc(p.mesa_nombre || ('Mesa ' + p.mesa))}</span><span class="t-hora">${hora(p.creado)}</span></div>
      ${servido ? '' : `<div class="t-estado"><span class="t-espera ${min >= 10 ? 'tarde' : ''}">${textoEspera(min)}</span></div>`}
      ${lineas}
      <div class="t-total"><span>TOTAL</span><span>${euros(p.total)}</span></div>
      ${pie}
    </div>
  </div>`;
}

// Un único escuchador para los botones de todas las tarjetas.
async function alTocarPedido(ev){
  const m = ev.target.closest('button[data-modificar]');
  if(m && !m.disabled){ abrirModificar(estado.pedidos.find(x => x.id === Number(m.dataset.modificar))); return; }
  const n = ev.target.closest('button[data-nuevo-mesa]');
  if(n){ const p = estado.pedidos.find(x => x.mesa === Number(n.dataset.nuevoMesa)); abrirNuevo(Number(n.dataset.nuevoMesa), p ? p.mesa_nombre : null); return; }
  const b = ev.target.closest('button[data-accion]');
  if(!b || b.disabled) return;
  const id = Number(b.dataset.id), accion = b.dataset.accion;
  const antes = (estado.pedidos.find(x => x.id === id) || {}).estado;
  estado.ocupado.add(id); pintarPedidos();
  try {
    const p = await datosPanel.marcar(id, accion);
    const i = estado.pedidos.findIndex(x => x.id === id);
    if(i >= 0 && p) estado.pedidos[i] = p;
    // Al deshacer a "nuevo" no debe volver a sonar.
    if(accion === 'enviado' && estado.vistos) estado.vistos.add(id);
    const deshacer = (antes === 'servido' && accion === 'en_preparacion') || (antes === 'en_preparacion' && accion === 'enviado');
    const mesa = p ? (p.mesa_nombre || 'Mesa ' + p.mesa) : '';
    toast(deshacer ? 'Cambio deshecho' : accion === 'servido' ? mesa + ' · pedido servido' : mesa + ' · pedido en preparación');
  } catch(e) {
    tratarError(e);
  } finally {
    estado.ocupado.delete(id);
    pintarPedidos();
  }
}
$('listaPendientes').addEventListener('click', alTocarPedido);
$('listaServidos').addEventListener('click', alTocarPedido);

/* =====================================================================
   AVISOS DE LAS MESAS (v15, opción avisos_mesa)
   «Llama al camarero» y «Pide la cuenta» desde la carta. Salen arriba, en
   cualquier pantalla del panel, con pitido, hasta que alguien pulsa
   «Atendido». Lo da la misma llamada que los pedidos (panel_estado).
   ===================================================================== */
function detectarAvisos(){
  if(estado.avisosVistos === null){ estado.avisosVistos = new Set(estado.avisos.map(a => a.id)); return; }
  const nuevos = estado.avisos.filter(a => !estado.avisosVistos.has(a.id));
  nuevos.forEach(a => estado.avisosVistos.add(a.id));
  if(nuevos.length){
    avisar('aviso');
    const a = nuevos[nuevos.length - 1];
    toast((a.mesa_nombre || 'Mesa ' + a.mesa) + (a.tipo === 'cuenta' ? ' · pide la cuenta' : ' · llama al camarero'));
  }
}
function pintarAvisos(){
  const caja = $('avisosMesa');
  if(!estado.avisos.length){ caja.hidden = true; caja.innerHTML = ''; return; }
  caja.hidden = false;
  caja.innerHTML = estado.avisos.map(a => `
    <div class="aviso-mesa ${a.tipo === 'cuenta' ? 'cuenta' : 'camarero'}">
      <div class="am-texto"><b>${esc(a.mesa_nombre || 'Mesa ' + a.mesa)}</b> · ${a.tipo === 'cuenta' ? 'Pide la cuenta' : 'Llama al camarero'}
        <span class="am-hora">${textoEspera(minutosDesde(a.creado))}</span></div>
      <div class="am-botones">
        ${a.tipo === 'cuenta' && opcionBar('cuentas_mesa') ? `<button class="btn btn-borde" type="button" data-ver-cuenta="${a.mesa}">Ver cuenta</button>` : ''}
        <button class="btn btn-azul" type="button" data-atender="${a.id}">Atendido</button>
      </div>
    </div>`).join('');
}
$('avisosMesa').addEventListener('click', async (ev) => {
  const v = ev.target.closest('button[data-ver-cuenta]');
  if(v){ estado.cuentaDestacada = Number(v.dataset.verCuenta); irA('cuentas'); return; }
  const b = ev.target.closest('button[data-atender]');
  if(!b || b.disabled) return;
  b.disabled = true;
  try {
    const r = await datosPanel.atenderAviso(Number(b.dataset.atender));
    if(Array.isArray(r)) estado.avisos = r;
    pintarAvisos();
  } catch(e) { b.disabled = false; tratarError(e); }
});

/* =====================================================================
   CUENTAS DE LAS MESAS (v15, opción cuentas_mesa)
   Todo lo pedido hoy por cada mesa y aún sin cobrar (de todos los móviles
   y de barra y cocina), con el total. «Cobrada» (dos toques) la cierra.
   ===================================================================== */
let cargandoCuentas = false;
async function cargarCuentas(){
  if(cargandoCuentas) return;
  cargandoCuentas = true;
  try {
    const [abiertas, cobradas] = await Promise.all([datosPanel.cuentas(), datosPanel.cobradas()]);
    estado.cuentas = Array.isArray(abiertas) ? abiertas : [];
    estado.cobradas = Array.isArray(cobradas) ? cobradas : [];
    pintarCuentas();
  } catch(e) { tratarError(e); }
  finally { cargandoCuentas = false; }
}
function nombreGrupo(g){ return g.camarero ? '🛎 Pedidos al camarero' : 'Móvil ' + g.movil; }
function lineasCuenta(ls, clase){
  return (ls || []).map(l => `
    <div class="linea ${clase || ''}"><span class="cant">${l.cantidad}×</span><span class="nombre">${esc(l.nombre)}</span><span class="puntos"></span><span class="precio">${euros(l.importe)}</span></div>`).join('');
}
// Solo se cobra lo SERVIDO: lo que aún no se ha servido sale aparte, en
// gris, y no entra en el total ni en «Cobrada».
function pintarCuentas(){
  const cs = estado.cuentas;
  const abiertas = cs.length ? cs.map(c => {
    const total = Number(c.total || 0), pendiente = Number(c.pendiente || 0);
    // Cobrar por separado (v34): si en la mesa piden varios móviles (o el
    // camarero), cada uno con su «Cobrar esto»; el botón de abajo cobra todo.
    const grupos = opcionBar('cobro_separado') && Array.isArray(c.grupos) && c.grupos.length > 1 ? c.grupos : null;
    const boton = total > 0
      ? `<button class="btn btn-azul" type="button" data-cobrar="${c.mesa}">${grupos ? 'Cobrar todo' : 'Cobrada'} · ${euros(total)}</button>`
      : `<button class="btn btn-borde" type="button" disabled>Nada servido todavía</button>`;
    const porPersona = grupos ? `
        <div class="cuenta-personas">
          <div class="cuenta-aviso">POR PERSONA</div>
          ${grupos.map(g => {
            const t = Number(g.total || 0), pend = Number(g.pendiente || 0);
            const resumen = (g.lineas || []).concat(g.lineas_pendientes || []).map(l => l.cantidad + '× ' + l.nombre).join(', ');
            return `<div class="persona">
              <div class="persona-datos">
                <div class="persona-nombre">${nombreGrupo(g)}<span>${euros(t)}</span></div>
                <div class="persona-lineas">${esc(resumen)}${pend ? ` · <i>sin servir ${euros(pend)}</i>` : ''}</div>
              </div>
              ${t > 0 ? `<button class="btn btn-borde" type="button" data-cobrar-grupo="${c.mesa}" data-movil="${g.movil}">Cobrar</button>` : `<span class="persona-nada">Nada servido</span>`}
            </div>`;
          }).join('')}
        </div>` : '';
    return `<div class="pedido" id="cuenta-${c.mesa}">
      <div class="tarjeta ${estado.cuentaDestacada === c.mesa ? 'destacada' : ''}">
        <div class="pedido-num">${esc(c.mesa_nombre || 'Mesa ' + c.mesa)}</div>
        <div class="t-arriba"><span class="t-hora">${c.pedidos} pedido${c.pedidos === 1 ? '' : 's'} · desde las ${hora(c.desde)}</span></div>
        ${total > 0 ? lineasCuenta(c.lineas) : ''}
        <div class="t-total"><span>A COBRAR</span><span>${euros(total)}</span></div>
        ${c.sin_servir ? `
          <div class="cuenta-pendiente">
            <div class="cuenta-aviso">⚠ Sin servir: no se cobra hasta que se sirva</div>
            ${lineasCuenta(c.lineas_pendientes, 'cero')}
            <div class="cuenta-sub"><span>Pendiente de servir</span><span>${euros(pendiente)}</span></div>
          </div>` : ''}
        ${porPersona}
        <div class="t-botones">${boton}</div>
      </div>
    </div>`;
  }).join('') : '<div class="vacio">No hay cuentas abiertas: todas las mesas están cobradas.</div>';
  const cobradas = (estado.cobradas || []).map(k => {
    return `<div class="fila-cobrada">
      <div><b>${esc(k.mesa_nombre || 'Mesa ' + k.mesa)}</b> · ${euros(k.total)}<span class="cobrada-info">${hora(k.cuando)}${k.por ? ' · ' + esc(k.por) : ''}</span></div>
      <button class="btn btn-borde" type="button" data-reabrir="${k.mesa}" data-cuando="${esc(k.cuando)}">Reabrir</button>
    </div>`;
  }).join('');
  $('listaCuentas').innerHTML = abiertas + (cobradas ? `<div class="titulo-seccion separado">COBRADAS HOY</div>
    <p class="sub-seccion">Si una se cobró por error, «Reabrir» la vuelve a poner arriba.</p>${cobradas}` : '');
  if(estado.cuentaDestacada != null){
    const el = $('cuenta-' + estado.cuentaDestacada);
    if(el) el.scrollIntoView({ block: 'center' });
    estado.cuentaDestacada = null;
  }
}
// Cobrar y reabrir piden confirmación en una ventana con el importe
// (v17, a petición de Carlos: el doble toque no se entendía).
$('listaCuentas').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-cobrar], button[data-reabrir], button[data-cobrar-grupo]');
  if(!b || b.disabled) return;
  if(b.dataset.cobrarGrupo){
    const mesa = Number(b.dataset.cobrarGrupo), movil = Number(b.dataset.movil);
    const c = estado.cuentas.find(x => x.mesa === mesa);
    const g = c && (c.grupos || []).find(x => x.movil === movil);
    if(!g) return;
    const nombre = c.mesa_nombre || 'Mesa ' + mesa;
    confirmarAccion('¿Cobrar ' + (g.camarero ? 'los pedidos al camarero' : 'el Móvil ' + movil) + '?',
      `<p class="confirmar-importe">${euros(g.total)}</p>
       <p class="texto-suave">${esc(nombre)}. Se cobra solo lo servido de ${g.camarero ? 'lo pedido al camarero' : 'ese móvil'}; el resto de la mesa sigue abierto.</p>`,
      'Sí, cobrar', async () => {
        const r = await datosPanel.cobrar(mesa, g.ids || []);
        toast(nombreGrupo(g).replace('🛎 ', '') + ' · cobrado ' + euros(r && r.total));
        await cargarCuentas();
        cargarPedidos();
      });
    return;
  }
  if(b.dataset.cobrar){
    const mesa = Number(b.dataset.cobrar);
    const c = estado.cuentas.find(x => x.mesa === mesa);
    if(!c) return;
    const nombre = c.mesa_nombre || 'Mesa ' + mesa;
    confirmarAccion('¿Cobrar ' + nombre + '?',
      `<p class="confirmar-importe">${euros(c.total)}</p>
       <p class="texto-suave">Se cobra solo lo servido.${c.sin_servir ? ' Lo que falta por servir (' + euros(c.pendiente) + ') se queda en la cuenta.' : ''}</p>`,
      'Sí, cobrar', async () => {
        // Solo los pedidos servidos que el camarero tiene en pantalla.
        const r = await datosPanel.cobrar(mesa, c.ids || []);
        toast(nombre + ' · cobrada ' + euros(r && r.total));
        estado.avisos = estado.avisos.filter(a => a.mesa !== mesa);
        pintarAvisos();
        await cargarCuentas();
        cargarPedidos(); // las tarjetas de esos pedidos pasan a «Cobrado» al momento
      });
    return;
  }
  const mesa = Number(b.dataset.reabrir), cuando = b.dataset.cuando;
  const k = (estado.cobradas || []).find(x => x.mesa === mesa && x.cuando === cuando) || {};
  const nombre = k.mesa_nombre || 'Mesa ' + mesa;
  confirmarAccion('¿Reabrir la cuenta de ' + nombre + '?',
    `<p class="confirmar-importe">${euros(k.total)}</p>
     <p class="texto-suave">Cobrada a las ${hora(cuando)}. Vuelve a quedar sin cobrar.</p>`,
    'Sí, reabrir', async () => {
      await datosPanel.reabrirCuenta(mesa, cuando);
      toast('Cuenta reabierta');
      await cargarCuentas();
      cargarPedidos();
    });
});

/* ---------------- AVISOS: SONIDO, VIBRACIÓN, PANTALLA ENCENDIDA ----------------
   Safari (iPhone) no deja sonar nada hasta que la persona toca la pantalla,
   y no permite vibrar desde una web. El primer toque en cualquier sitio
   activa el sonido; además la cabecera parpadea y el título de la pestaña
   cuenta los pedidos nuevos. */
let audio = null, bloqueoPantalla = null;

function activarSonido(){
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if(AC){ audio = audio || new AC(); if(audio.state !== 'running') audio.resume(); }
  } catch(e) { /* sin sonido */ }
  mantenerPantalla();
  if(!estado.sonidoActivo && audio){
    estado.sonidoActivo = true;
    pintarVivo();
  }
}
['click', 'touchend'].forEach(t => document.addEventListener(t, activarSonido, { passive: true }));

function pitar(tipo){
  if(!audio) return;
  try {
    const notas = tipo === 'nuevo' ? [[880, 0], [1175, .18], [880, .36], [1175, .54]]
                : tipo === 'aviso' ? [[1320, 0], [990, .2], [1320, .4]]   // aviso de una mesa (v15)
                : [[660, 0], [880, .18]];
    notas.forEach(([f, t]) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, audio.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.6, audio.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + t + 0.16);
      o.connect(g); g.connect(audio.destination);
      o.start(audio.currentTime + t); o.stop(audio.currentTime + t + 0.17);
    });
  } catch(e) { /* sin sonido */ }
}

function avisar(tipo){
  pitar(tipo);
  if(navigator.vibrate) navigator.vibrate(tipo === 'nuevo' || tipo === 'aviso' ? [300, 150, 300, 150, 300] : [200]);
  document.body.classList.remove('destello'); void document.body.offsetWidth;
  document.body.classList.add('destello');
  setTimeout(() => document.body.classList.remove('destello'), 3000);
  if(tipo === 'nuevo' && estado.vista !== 'pedidos') toast('¡Pedido nuevo! Abre el menú y entra en Pedidos');
}

// Que la pantalla no se apague (iPhone con iOS 16.4 o más, y Android).
async function mantenerPantalla(){
  try {
    if('wakeLock' in navigator && !bloqueoPantalla && document.visibilityState === 'visible' && estado.sesion){
      bloqueoPantalla = await navigator.wakeLock.request('screen');
      bloqueoPantalla.addEventListener('release', () => { bloqueoPantalla = null; });
    }
  } catch(e) { /* no disponible */ }
}

document.addEventListener('visibilitychange', () => {
  if(document.visibilityState !== 'visible' || !estado.sesion) return;
  if(audio && audio.state !== 'running') audio.resume().catch(() => {});
  if(estado.sonidoActivo) mantenerPantalla();
  cargarPedidos();
});

// Cada 30 s se repintan los minutos de espera aunque no cambie nada.
setInterval(() => { if(estado.sesion && estado.vista === 'pedidos') pintarPedidos(); }, 30000);

/* =====================================================================
   LISTA DE PRECIOS: AGOTADOS (barra y admin) Y PRECIOS (admin)
   ===================================================================== */
async function cargarProductos(){
  const esAdmin = estado.sesion.rol === 'admin';
  $('nuevoProd').hidden = !esAdmin;
  $('barraGuardar').hidden = !esAdmin;
  $('preciosAyuda').textContent = esAdmin
    ? 'Cambia los precios y pulsa «Guardar cambios». Toca un nombre para editarlo. «Agotado» lo quita de la carta al momento.'
    : 'Toca «Hay» para marcar un producto como agotado, y otra vez cuando vuelva a haber.';
  $('listaProductos').innerHTML = '<div class="vacio">Cargando precios…</div>';
  try {
    const [prods, menu] = await Promise.all([datosPanel.productos(), estado.categorias.length ? null : datosCarta.menu()]);
    estado.productos = prods || [];
    if(menu) estado.categorias = menu.map(c => ({ id: c.id, nombre: c.name }));
    pintarProductos();
  } catch(e) {
    $('listaProductos').innerHTML = '';
    tratarError(e);
  }
}

function pintarProductos(){
  const esAdmin = estado.sesion.rol === 'admin';
  const q = $('buscaProd').value.trim().toLowerCase();
  let html = '', filas = 0;
  estado.categorias.forEach(c => {
    const prods = estado.productos.filter(p => p.categoria === c.id && (esAdmin || p.visible)
      && (!q || (p.nombre || '').toLowerCase().includes(q)));
    if(!prods.length) return;
    filas += prods.length;
    html += `<div class="cat-titulo">${esc(c.nombre)}</div>`;
    html += prods.map(p => {
      const cambiado = p.id in estado.cambios;
      const valor = cambiado ? estado.cambios[p.id] : Number(p.precio).toFixed(2);
      return `<div class="prod ${cambiado ? 'cambiado' : ''} ${p.visible ? '' : 'oculto'}" data-prod="${p.id}">
        <div class="prod-info">
          ${esAdmin ? `<button class="prod-nombre" type="button" data-editar="${p.id}">${esc(p.nombre)}</button>` : `<div class="prod-nombre">${esc(p.nombre)}</div>`}
          <div class="prod-sub">${opcionBar('destacados') ? `<button class="chip-marca ${p.marca ? 'con marca-' + p.marca : ''}" type="button" data-marca="${p.id}">${p.marca ? '★ ' + MARCAS[p.marca] : '☆ Destacar'}</button>` : ''}${p.visible ? '' : '<span class="chip">Oculto en la carta</span>'}${esc(p.descripcion || '')}</div>
        </div>
        <button class="hay ${p.disponible ? '' : 'agotado'}" type="button" data-disp="${p.id}" aria-pressed="${!p.disponible}">${p.disponible ? 'Hay' : 'Agotado'}</button>
        ${esAdmin
          ? `<label class="campo-precio"><input type="text" inputmode="decimal" data-precio="${p.id}" value="${esc(String(valor).replace('.', ','))}" aria-label="Precio de ${esc(p.nombre)}"><span>€</span></label>`
          : `<span class="precio-fijo">${euros(p.precio)}</span>`}
      </div>`;
    }).join('');
  });
  $('listaProductos').innerHTML = filas ? html : '<div class="vacio">No hay productos que coincidan.</div>';
  pintarCambios();
}

function pintarCambios(){
  const n = Object.keys(estado.cambios).length;
  $('nCambios').innerHTML = n === 0 ? 'Sin cambios' : `<b>${n}</b> ${n === 1 ? 'precio cambiado' : 'precios cambiados'}`;
  $('guardarPrecios').disabled = n === 0;
}

$('buscaProd').addEventListener('input', pintarProductos);

$('listaProductos').addEventListener('input', (ev) => {
  const inp = ev.target.closest('[data-precio]');
  if(!inp) return;
  const id = Number(inp.dataset.precio);
  const p = estado.productos.find(x => x.id === id);
  const v = Number(inp.value.replace(',', '.'));
  if(p && inp.value.trim() !== '' && !isNaN(v) && Math.abs(v - Number(p.precio)) < 0.005) delete estado.cambios[id];
  else estado.cambios[id] = inp.value.trim();
  inp.closest('.prod').classList.toggle('cambiado', id in estado.cambios);
  pintarCambios();
});

$('guardarPrecios').addEventListener('click', async () => {
  const ids = Object.keys(estado.cambios).map(Number);
  for(const id of ids){
    const v = Number(String(estado.cambios[id]).replace(',', '.'));
    if(String(estado.cambios[id]).trim() === '' || isNaN(v) || v < 0 || v >= 1000){
      const p = estado.productos.find(x => x.id === id);
      return toast('El precio de «' + (p ? p.nombre : id) + '» no es válido.', true);
    }
  }
  const b = $('guardarPrecios');
  b.disabled = true; b.textContent = 'Guardando…';
  try {
    for(const id of ids){
      const precio = Number(String(estado.cambios[id]).replace(',', '.'));
      await datosPanel.guardarProducto({ id, precio });
      const p = estado.productos.find(x => x.id === id);
      if(p) p.precio = precio;
      delete estado.cambios[id];
    }
    toast(ids.length === 1 ? 'Precio guardado' : ids.length + ' precios guardados');
  } catch(e) { tratarError(e); }
  b.textContent = 'Guardar cambios';
  pintarProductos();
});

$('listaProductos').addEventListener('click', async (ev) => {
  const disp = ev.target.closest('[data-disp]');
  if(disp){
    const p = estado.productos.find(x => x.id === Number(disp.dataset.disp));
    if(!p) return;
    disp.disabled = true;
    try {
      await datosPanel.disponible(p.id, !p.disponible);
      p.disponible = !p.disponible;
      toast(p.disponible ? p.nombre + ': vuelve a haber' : p.nombre + ': agotado');
    } catch(e) { tratarError(e); }
    pintarProductos();
    return;
  }
  const mb = ev.target.closest('[data-marca]');
  if(mb) return elegirMarca(estado.productos.find(x => x.id === Number(mb.dataset.marca)));
  const ed = ev.target.closest('[data-editar]');
  if(ed) editarProducto(estado.productos.find(x => x.id === Number(ed.dataset.editar)));
});

/* ---------------- RECOMENDADOS (v25, opción ajustes.destacados) ----------------
   Barra y admin ponen a un producto la etiqueta que sale en la carta y en su
   pestaña «Recomendados». Se guarda al momento. */
const MARCAS = { del_dia: 'Plato del día', recomendado: 'Recomendado', nuevo: 'Nuevo' };
function elegirMarca(p){
  if(!p) return;
  abrirModalLibre('Etiqueta en la carta', () => {
    $('modalCampos').innerHTML = `<p class="sub-seccion">${esc(p.nombre)}</p>
      <div class="opciones-marca">
        ${Object.keys(MARCAS).map(m => `<button type="button" class="btn ${p.marca === m ? 'btn-naranja' : 'btn-borde'}" data-m="${m}">${MARCAS[m]}</button>`).join('')}
        <button type="button" class="btn ${p.marca ? 'btn-borde' : 'btn-naranja'}" data-m="">Sin etiqueta</button>
      </div>`;
  }, null);
  estado.alTocarModal = async (ev) => {
    const b = ev.target.closest('[data-m]');
    if(!b || b.disabled) return;
    const m = b.dataset.m;
    $('modalCampos').querySelectorAll('[data-m]').forEach(x => { x.disabled = true; });
    try {
      await datosPanel.marca(p.id, m);
      p.marca = m || null;
      cerrarModal();
      toast(m ? p.nombre + ': ' + MARCAS[m] : p.nombre + ': sin etiqueta');
      pintarProductos();
    } catch(e) {
      $('modalCampos').querySelectorAll('[data-m]').forEach(x => { x.disabled = false; });
      if(e.codigo === 'SESION_CADUCADA'){ cerrarModal(); return volverAlLogin(e.message); }
      $('modalError').textContent = e.message; $('modalError').hidden = false;
    }
  };
}

/* =====================================================================
   HORARIOS DE LA CARTA (v25, admin, opción ajustes.horarios)
   Cada pestaña de la carta puede tener días y horas. Fuera de horario la
   carta la enseña en gris y no deja pedirla (la base también lo comprueba).
   Los pedidos que mete el personal desde aquí sí se pueden hacer.
   ===================================================================== */
const DIAS_CORTOS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const DIAS_LARGOS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
function listaY(xs){ return xs.length > 1 ? xs.slice(0, -1).join(', ') + ' y ' + xs[xs.length - 1] : (xs[0] || ''); }
function textoHorario(h){
  if(!h || !Array.isArray(h.tramos) || !h.tramos.length) return 'Siempre';
  let t = listaY(h.tramos.map(x => x.desde === x.hasta ? 'todo el día' : 'de ' + x.desde + ' a ' + x.hasta));
  const d = (Array.isArray(h.dias) ? h.dias : []).map(Number).sort();
  if(d.length && d.length < 7){
    const seguidos = d.every((n, i) => i === 0 || n === d[i - 1] + 1);
    t += ', ' + (seguidos && d.length > 2 ? 'de ' + DIAS_LARGOS[d[0] - 1] + ' a ' + DIAS_LARGOS[d[d.length - 1] - 1] : listaY(d.map(n => DIAS_LARGOS[n - 1])));
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}
async function cargarHorarios(){
  if(!estado.horarios) $('listaHorarios').innerHTML = '<div class="vacio">Cargando…</div>';
  try { estado.horarios = await datosPanel.horarios() || []; pintarHorarios(); }
  catch(e) { tratarError(e); }
}
function pintarHorarios(){
  $('listaHorarios').innerHTML = (estado.horarios || []).map(c => `
    <div class="ficha mesa-abrir">
      <div>
        <div class="ficha-titulo">${esc(c.nombre)}</div>
        <div class="ficha-detalle">${esc(textoHorario(c.horario))}${c.horario ? ` · <span class="estado-mesa ${c.abierta ? 'si' : ''}">${c.abierta ? 'Ahora se sirve' : 'Ahora no se sirve'}</span>` : ''}</div>
      </div>
      <button class="btn btn-borde" type="button" data-horario="${esc(c.id)}">Cambiar</button>
    </div>`).join('') || '<div class="vacio">No hay pestañas en la carta.</div>';
}
$('listaHorarios').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-horario]');
  if(b) editarHorario((estado.horarios || []).find(c => c.id === b.dataset.horario));
});
function editarHorario(c){
  if(!c) return;
  const h = c.horario || {};
  const dias = Array.isArray(h.dias) && h.dias.length ? h.dias.map(Number) : [1, 2, 3, 4, 5, 6, 7];
  const tr = Array.isArray(h.tramos) ? h.tramos : [];
  const tramo = (i) => `<div class="fila-tramo"><span>${i === 0 ? 'Horario' : 'Y también'}</span>
      <input type="time" id="hDesde${i}" value="${esc((tr[i] || {}).desde || '')}" aria-label="Desde">
      <span>a</span>
      <input type="time" id="hHasta${i}" value="${esc((tr[i] || {}).hasta || '')}" aria-label="Hasta"></div>`;
  abrirModalLibre(c.nombre, () => {
    $('modalCampos').innerHTML = `
      <label class="campo campo-check"><input type="checkbox" id="hSiempre" ${c.horario ? '' : 'checked'}><span>Siempre disponible (sin horario)</span></label>
      <div id="hDetalle" ${c.horario ? '' : 'hidden'}>
        <p class="sub-seccion">Días</p>
        <div class="dias-semana">${DIAS_CORTOS.map((d, i) => `<label><input type="checkbox" data-dia="${i + 1}" ${dias.includes(i + 1) ? 'checked' : ''}><span>${d}</span></label>`).join('')}</div>
        <p class="sub-seccion">Horas (si cierra después de medianoche, pon p. ej. de 20:00 a 01:00)</p>
        ${tramo(0)}${tramo(1)}
      </div>`;
    $('hSiempre').addEventListener('change', () => { $('hDetalle').hidden = $('hSiempre').checked; });
  }, async () => {
    let horario = null;
    if(!$('hSiempre').checked){
      const ds = [...$('modalCampos').querySelectorAll('[data-dia]')].filter(x => x.checked).map(x => Number(x.dataset.dia));
      const tramos = [0, 1].map(i => ({ desde: $('hDesde' + i).value, hasta: $('hHasta' + i).value })).filter(t => t.desde || t.hasta);
      if(!ds.length) throw new Error('Marca al menos un día.');
      if(!tramos.length) throw new Error('Pon al menos un horario (desde y hasta).');
      if(tramos.some(t => !t.desde || !t.hasta)) throw new Error('Cada horario necesita hora de inicio y de fin.');
      horario = { dias: ds, tramos };
    }
    c.horario = await datosPanel.guardarHorario(c.id, horario);
    toast(c.nombre + ': ' + textoHorario(c.horario).toLowerCase());
    cargarHorarios();
  });
}

$('nuevoProd').addEventListener('click', () => editarProducto(null));

function editarProducto(p){
  const nuevo = !p;
  p = p || { categoria: (estado.categorias[0] || {}).id, nombre: '', nombre_corto: '', descripcion: '', tamano: '', seccion: '', precio: '', visible: true, disponible: true };
  abrirModal(nuevo ? 'Nuevo producto' : 'Editar producto', [
    { id: 'nombre', etiqueta: 'Nombre (como sale en el tique)', valor: p.nombre, ayuda: 'Ej.: Croquetas de puchero (Tapa)' },
    { id: 'nombre_corto', etiqueta: 'Nombre sin tamaño (para agrupar Tapa y Plato)', valor: p.nombre_corto || '' },
    { id: 'descripcion', etiqueta: 'Descripción', valor: p.descripcion || '' },
    { id: 'precio', etiqueta: 'Precio (€)', valor: p.precio === '' ? '' : String(p.precio).replace('.', ','), tipo: 'decimal' },
    { id: 'tamano', etiqueta: 'Tamaño', tipo: 'select', valor: p.tamano || '', opciones: [['', 'Sin tamaño'], ...TAMANOS.map(t => [t, t])] },
    { id: 'categoria', etiqueta: 'Pestaña de la carta', tipo: 'select', valor: p.categoria, opciones: estado.categorias.map(c => [c.id, c.nombre]) },
    { id: 'seccion', etiqueta: 'Sección (subtítulo)', valor: p.seccion || '' },
    { id: 'visible', etiqueta: 'Se ve en la carta', tipo: 'check', valor: p.visible },
    { id: 'disponible', etiqueta: 'Hay (no agotado)', tipo: 'check', valor: p.disponible },
    // Ración (v30, opción ajustes.raciones): «para 2–3 personas».
    ...(opcionBar('raciones') ? [{ id: 'racion', etiqueta: 'Ración (opcional)', valor: p.racion || '', ayuda: 'Ej.: para 2–3 personas · ideal para compartir. Máx. 40 letras.' }] : []),
  ], async (v) => {
    const precio = Number(String(v.precio).replace(',', '.'));
    if(!v.nombre.trim()) throw new Error('Escribe el nombre.');
    if(v.precio === '' || !(precio >= 0 && precio < 1000)) throw new Error('El precio no es válido.');
    const datos = { nombre: v.nombre, nombre_corto: v.nombre_corto, descripcion: v.descripcion, precio, tamano: v.tamano,
      solo_tamano: false, categoria: v.categoria, seccion: v.seccion, visible: v.visible, disponible: v.disponible };
    if(!nuevo){ datos.id = p.id; delete datos.solo_tamano; delete estado.cambios[p.id]; }
    if(opcionBar('raciones')){
      if(v.racion.length > 40) throw new Error('La ración es demasiado larga (máx. 40 letras).');
      datos.racion = v.racion;
    }
    if(opcionBar('alergenos')) datos.alergenos = Array.from(document.querySelectorAll('#modalCampos .al-panel input:checked')).map(i => i.value);
    await datosPanel.guardarProducto(datos);
    toast('Producto guardado');
    cargarProductos();
  });
  if(opcionBar('alergenos')) pintarAlergenosProducto(p.alergenos || []);
  if(opcionBar('fotos')) pintarFotoProducto(nuevo ? null : p);
}

/* ---------------- ALÉRGENOS DE UN PRODUCTO (v30, admin, opción ajustes.alergenos) ----------------
   Los 14 de la normativa europea. Se guardan con el botón «Guardar» y se
   ponen igual en los otros tamaños del mismo plato (Tapa / Plato…). */
const ALERGENOS = [
  ['gluten', '🌾 Gluten'], ['crustaceos', '🦐 Crustáceos'], ['huevo', '🥚 Huevo'], ['pescado', '🐟 Pescado'],
  ['cacahuetes', '🥜 Cacahuetes'], ['soja', '🌱 Soja'], ['lacteos', '🥛 Lácteos'], ['frutos_cascara', '🌰 Frutos de cáscara'],
  ['apio', '🥬 Apio'], ['mostaza', '🟡 Mostaza'], ['sesamo', '⚪ Sésamo'], ['sulfitos', '🍷 Sulfitos'],
  ['altramuces', '🌼 Altramuces'], ['moluscos', '🦪 Moluscos'],
];
function pintarAlergenosProducto(marcados){
  const caja = document.createElement('div');
  caja.className = 'campo al-panel';
  caja.innerHTML = `<span>Alérgenos que lleva</span>
    <div class="al-rejilla">${ALERGENOS.map(([k, t]) => `<label class="al-check"><input type="checkbox" value="${k}"${marcados.includes(k) ? ' checked' : ''}><span>${esc(t)}</span></label>`).join('')}</div>
    <small>Se ponen igual en sus otros tamaños (Tapa / Plato). Que los confirme la cocina.</small>`;
  $('modalCampos').appendChild(caja);
}

/* ---------------- FOTOS DE LOS PRODUCTOS (v26, admin, opción ajustes.fotos) ----------------
   En la ventana de editar un producto: hacer la foto con el móvil o elegirla
   de la galería, cambiarla o quitarla. Se guarda al momento (aparte del botón
   «Guardar»). El móvil la recorta en cuadrado y la deja en 800 px (JPEG, unos
   100–200 KB) antes de mandarla a la función del servidor «subir-foto». */
function pintarFotoProducto(p){
  const caja = document.createElement('div');
  caja.className = 'campo foto-producto';
  $('modalCampos').appendChild(caja);
  if(!p){
    caja.innerHTML = '<span>Foto en la carta</span><small>Guarda el producto y vuelve a abrirlo para añadirle una foto.</small>';
    return;
  }
  const pintar = (estadoTxt) => {
    caja.innerHTML = `<span>Foto en la carta</span>
      <div class="foto-fila">
        <div class="foto-previa">${p.foto ? `<img src="${esc(p.foto)}" alt="">` : 'Sin foto'}</div>
        <div class="foto-botones">
          <label class="btn btn-borde foto-elegir">${p.foto ? 'Cambiar foto' : 'Añadir foto'}<input type="file" accept="image/*" hidden></label>
          ${p.foto ? '<button type="button" class="btn btn-borde foto-quitar">Quitar foto</button>' : ''}
        </div>
      </div>
      <small class="foto-estado">${esc(estadoTxt || 'Mejor una foto real del plato, con buena luz. Sale recortada en cuadrado.')}</small>`;
    caja.querySelector('input[type=file]').addEventListener('change', async (ev) => {
      const archivo = ev.target.files && ev.target.files[0];
      if(!archivo) return;
      ocupado(true, 'Preparando la foto…');
      try {
        const imagen = await reducirFoto(archivo);
        ocupado(true, 'Subiendo la foto…');
        p.foto = await datosPanel.subirFoto(p.id, imagen);
        toast('Foto guardada');
        pintar('Foto guardada. Ya sale en la carta.');
      } catch(e) {
        if(e.codigo === 'SESION_CADUCADA'){ cerrarModal(); return volverAlLogin(e.message); }
        pintar(e.message || 'No se ha podido subir la foto.');
      }
    });
    const q = caja.querySelector('.foto-quitar');
    if(q) q.addEventListener('click', async () => {
      ocupado(true, 'Quitando la foto…');
      try { p.foto = await datosPanel.subirFoto(p.id, null); toast('Foto quitada'); pintar('Foto quitada.'); }
      catch(e) {
        if(e.codigo === 'SESION_CADUCADA'){ cerrarModal(); return volverAlLogin(e.message); }
        pintar(e.message);
      }
    });
  };
  const ocupado = (si, txt) => {
    caja.querySelectorAll('button, input').forEach(x => { x.disabled = si; });
    caja.querySelector('.foto-elegir').classList.toggle('desactivado', si);
    caja.querySelector('.foto-estado').textContent = txt;
  };
  pintar();
}

// Recorta la foto en cuadrado (el centro) y la deja en 800 × 800 px, JPEG.
function reducirFoto(archivo){
  return new Promise((ok, mal) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      try {
        const lado = Math.min(img.naturalWidth, img.naturalHeight);
        if(!lado) throw new Error('La foto no se puede leer.');
        const T = Math.min(800, lado);
        const lienzo = document.createElement('canvas');
        lienzo.width = lienzo.height = T;
        lienzo.getContext('2d').drawImage(img, (img.naturalWidth - lado) / 2, (img.naturalHeight - lado) / 2, lado, lado, 0, 0, T, T);
        ok(lienzo.toDataURL('image/jpeg', 0.82));
      } catch(e) { mal(e); }
      finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('Esa foto no se puede leer. Prueba con otra (JPG o PNG).')); };
    img.src = url;
  });
}

/* =====================================================================
   MODIFICAR UN PEDIDO (camarero, barra y admin; en cualquier estado)
   Solo quitar o cambiar cantidades: quitar deja la línea a 0 (se ve en gris
   en la tarjeta). Para añadir cosas se hace un pedido nuevo para la mesa.
   ===================================================================== */
function abrirModificar(p){
  if(!p) return;
  const cant = {};                       // id de línea -> cantidad nueva
  (p.lineas || []).forEach(l => { cant[l.id] = l.cantidad; });

  const pintar = () => {
    const filas = (p.lineas || []).map(l => `
      <div class="mod-fila ${cant[l.id] === 0 ? 'cero' : ''}">
        <div class="mod-nombre">${esc(l.nombre)}<small>${euros(l.precio)} / ud.</small></div>
        <div class="paso">
          <button type="button" data-menos="${l.id}" aria-label="Quitar uno" ${cant[l.id] <= 0 ? 'disabled' : ''}>−</button>
          <span>${cant[l.id]}</span>
          <button type="button" data-mas="${l.id}" aria-label="Añadir uno" ${cant[l.id] >= 20 ? 'disabled' : ''}>+</button>
        </div>
      </div>`).join('');
    const total = (p.lineas || []).reduce((s, l) => s + l.precio * cant[l.id], 0);
    $('modalCampos').innerHTML = `
      <p class="texto-suave">${esc(p.mesa_nombre || 'Mesa ' + p.mesa)} · toca − para quitar un producto (queda a 0 y en gris). Para pedir algo más, usa «+ Nuevo pedido».</p>
      <div class="mod-lista">${filas}</div>
      <div class="t-total"><span>TOTAL NUEVO</span><span>${euros(total)}</span></div>`;
  };

  estado.alTocarModal = (ev) => {
    const t = ev.target.closest('button');
    if(!t) return;
    if(t.dataset.menos) cant[t.dataset.menos] = Math.max(0, cant[t.dataset.menos] - 1);
    else if(t.dataset.mas) cant[t.dataset.mas] = Math.min(20, cant[t.dataset.mas] + 1);
    else return;
    pintar();
  };

  abrirModalLibre('Modificar pedido nº ' + (p.numero || p.id), pintar, async () => {
    const lineas = (p.lineas || []).filter(l => cant[l.id] !== l.cantidad).map(l => ({ id: l.id, cantidad: cant[l.id] }));
    if(!lineas.length) return;
    const r = await datosPanel.modificar(p.id, { lineas });
    const i = estado.pedidos.findIndex(x => x.id === p.id);
    if(i >= 0 && r) estado.pedidos[i] = r;
    pintarPedidos();
    toast('Pedido nº ' + (p.numero || p.id) + ' modificado');
  });
}

/* =====================================================================
   NUEVO PEDIDO DEL CAMARERO
   Desde una tarjeta (la mesa ya va puesta) o desde «+ Nuevo pedido» de la
   pantalla principal (primero se elige la mesa). Se abre la carta, igual que
   la del cliente, y el pedido entra como NUEVO, igual que los del cliente.
   ===================================================================== */
const nuevo = { mesa: null, mesaNombre: '', cant: {}, notas: {}, pestana: null, enviando: false };

async function cargarCartaPanel(){
  if(!estado.menuCarta) estado.menuCarta = await datosCarta.menu();
  return estado.menuCarta;
}

// Elegir la mesa (pantalla principal).
async function elegirMesa(){
  let mesas;
  try { mesas = await datosPanel.mesasPanel(); }
  catch(e) { return tratarError(e); }
  abrirModalLibre('¿Para qué mesa?', () => {
    $('modalCampos').innerHTML = `<div class="rejilla-mesas">${(mesas || []).map(m =>
      `<button type="button" class="btn btn-borde" data-elegir-mesa="${m.id}" data-nombre="${esc(m.nombre)}" ${m.activa ? '' : 'disabled'}>${esc(m.nombre)}</button>`).join('')}</div>`;
  }, null);
  $('modalForm').querySelector('[type=submit]').hidden = true;
  estado.alTocarModal = (ev) => {
    const b = ev.target.closest('[data-elegir-mesa]');
    if(!b) return;
    cerrarModal();
    abrirNuevo(Number(b.dataset.elegirMesa), b.dataset.nombre);
  };
}
$('nuevoPedido').addEventListener('click', elegirMesa);

async function abrirNuevo(mesa, mesaNombre){
  try { await cargarCartaPanel(); }
  catch(e) { return tratarError(e); }
  Object.assign(nuevo, { mesa, mesaNombre: mesaNombre || ('Mesa ' + mesa), cant: {}, notas: {}, enviando: false });
  nuevo.pestana = (estado.menuCarta[0] || {}).id;
  $('nvMesa').textContent = nuevo.mesaNombre.toUpperCase() + ' · NUEVO PEDIDO';
  $('nvBusca').value = '';
  $('nvPestanas').innerHTML = estado.menuCarta.map(c => `<button type="button" data-pestana="${esc(c.id)}">${esc(c.name)}</button>`).join('');
  $('vNuevo').hidden = false;
  document.documentElement.classList.add('sin-scroll');
  pintarNuevo();
}

function cerrarNuevo(){
  $('vNuevo').hidden = true;
  document.documentElement.classList.remove('sin-scroll');
}

// Pinta la carta: una pestaña cada vez (o todo lo que coincida con la búsqueda).
function pintarNuevo(){
  const q = $('nvBusca').value.trim().toLowerCase();
  $('nvPestanas').querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String(!q && b.dataset.pestana === nuevo.pestana)));
  const cats = q ? estado.menuCarta : estado.menuCarta.filter(c => c.id === nuevo.pestana);
  let html = '';
  cats.forEach(c => {
    const items = (c.items || []).filter(it => !q || (it.n || '').toLowerCase().includes(q) || (it.d || '').toLowerCase().includes(q));
    if(!items.length) return;
    if(q) html += `<div class="nv-cat">${esc(c.name)}</div>`;
    let seccion = null;
    for(let i = 0; i < items.length; i++){
      const it = items[i];
      if(!q && c.multi && it.sec && it.sec !== seccion){ seccion = it.sec; html += `<div class="nv-sec">${esc(seccion)}</div>`; }
      // Mismo producto en varios tamaños (Tapa/Plato, Copa/Botella): un nombre y una fila por tamaño.
      if(it.size && !it.only){
        const grupo = [it];
        while(i + 1 < items.length && items[i + 1].dn === it.dn && items[i + 1].size && !items[i + 1].only) grupo.push(items[++i]);
        const comun = grupo.every(x => x.d === grupo[0].d) && grupo[0].d;
        html += `<div class="nv-prod"><div class="nv-nombre">${esc(it.dn || it.n)}</div>${comun ? `<div class="nv-desc">${esc(comun)}</div>` : ''}
          ${grupo.map(x => filaNuevo(x, x.size + (!comun && x.d ? ' · ' + x.d : ''))).join('')}</div>`;
      } else {
        html += `<div class="nv-prod">${filaNuevo(it, null)}</div>`;
      }
    }
  });
  $('nvLista').innerHTML = html || '<div class="vacio">No hay productos que coincidan.</div>';
  pintarDockNuevo();
}

function filaNuevo(it, etiqueta){
  const id = it.dbId, n = nuevo.cant[id] || 0;
  const control = it.agotado ? '<span class="nv-agotado">Agotado</span>'
    : n === 0 ? `<button type="button" class="nv-mas" data-nv-mas="${id}" aria-label="Añadir ${esc(it.n)}">+</button>`
    : `<div class="paso"><button type="button" data-nv-menos="${id}" aria-label="Uno menos">−</button><span>${n}</span><button type="button" data-nv-mas="${id}" aria-label="Uno más" ${n >= 20 ? 'disabled' : ''}>+</button></div>`;
  return `<div class="nv-fila ${it.agotado ? 'agotado' : ''}">
      <div class="nv-info">
        ${etiqueta === null ? `<div class="nv-nombre">${esc(it.dn || it.n)}</div>${it.d ? `<div class="nv-desc">${esc(it.d)}</div>` : ''}` : `<div class="nv-tam">${esc(etiqueta)}</div>`}
        <div class="nv-precio">${euros(it.p)}</div>
      </div>
      ${control}
    </div>
    ${n > 0 ? `<input class="nv-nota" data-nv-nota="${id}" maxlength="140" placeholder="nota (opcional)" value="${esc(nuevo.notas[id] || '')}" autocomplete="off">` : ''}`;
}

function lineasNuevo(){
  const precios = {};
  estado.menuCarta.forEach(c => (c.items || []).forEach(it => { precios[it.dbId] = it; }));
  return Object.keys(nuevo.cant).filter(id => nuevo.cant[id] > 0).map(id => ({
    producto: Number(id), cantidad: nuevo.cant[id], nota: (nuevo.notas[id] || '').trim(), precio: Number(precios[id].p) }));
}

function pintarDockNuevo(){
  const ls = lineasNuevo();
  const uds = ls.reduce((s, l) => s + l.cantidad, 0);
  $('nvUds').textContent = uds ? uds + (uds === 1 ? ' producto' : ' productos') : 'Sin productos';
  $('nvTotal').textContent = euros(ls.reduce((s, l) => s + l.precio * l.cantidad, 0));
  $('nvEnviar').disabled = !uds || nuevo.enviando;
}

$('nvPestanas').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-pestana]');
  if(!b) return;
  nuevo.pestana = b.dataset.pestana; $('nvBusca').value = '';
  pintarNuevo();
  document.querySelector('.nv-cuerpo').scrollTop = 0;
});
$('nvBusca').addEventListener('input', pintarNuevo);
$('nvLista').addEventListener('click', (ev) => {
  const mas = ev.target.closest('[data-nv-mas]'), menos = ev.target.closest('[data-nv-menos]');
  if(mas) nuevo.cant[mas.dataset.nvMas] = Math.min(20, (nuevo.cant[mas.dataset.nvMas] || 0) + 1);
  else if(menos) nuevo.cant[menos.dataset.nvMenos] = Math.max(0, (nuevo.cant[menos.dataset.nvMenos] || 0) - 1);
  else return;
  pintarNuevo();
});
$('nvLista').addEventListener('input', (ev) => {
  const n = ev.target.closest('[data-nv-nota]');
  if(n) nuevo.notas[n.dataset.nvNota] = n.value;
});
$('nvCerrar').addEventListener('click', () => {
  if(lineasNuevo().length && !confirmarCierre()) return;
  cerrarNuevo();
});
// Segundo toque en ✕ para descartar un pedido a medias (sin ventanas del navegador).
let avisoCierre = 0;
function confirmarCierre(){
  if(Date.now() - avisoCierre < 4000) return true;
  avisoCierre = Date.now();
  toast('Toca ✕ otra vez para descartar este pedido');
  return false;
}
$('nvEnviar').addEventListener('click', async () => {
  const ls = lineasNuevo();
  if(!ls.length || nuevo.enviando) return;
  nuevo.enviando = true; $('nvEnviar').textContent = 'Enviando…'; pintarDockNuevo();
  try {
    const p = await datosPanel.crearPedido(nuevo.mesa, ls.map(l => ({ producto: l.producto, cantidad: l.cantidad, nota: l.nota })));
    // Con barra y cocina separadas llega en dos partes (v15).
    const partes = p && Array.isArray(p.partes) && p.partes.length ? p.partes : (p ? [p] : []);
    partes.forEach(x => { estado.pedidos.push(x); if(estado.vistos) estado.vistos.add(x.id); });
    cerrarNuevo();
    if(estado.vista !== 'pedidos') irA('pedidos'); else pintarPedidos();
    toast(nuevo.mesaNombre + ' · pedido enviado a barra');
  } catch(e) {
    tratarError(e);
  } finally {
    nuevo.enviando = false; $('nvEnviar').textContent = 'Enviar pedido'; pintarDockNuevo();
  }
});

/* =====================================================================
   RESUMEN DEL DÍA (con los pedidos de hoy que ya tiene el panel)
   ===================================================================== */
function pintarResumen(){
  const hoy = estado.pedidos.filter(deHoy);
  const porArticulo = {};
  let unidades = 0, total = 0;
  hoy.forEach(p => {
    total += Number(p.total || 0);
    (p.lineas || []).forEach(l => {
      if(!l.cantidad) return;   // quitado por el personal
      unidades += l.cantidad;
      const a = porArticulo[l.nombre] = porArticulo[l.nombre] || { cant: 0, importe: 0 };
      a.cant += l.cantidad; a.importe += l.cantidad * Number(l.precio);
    });
  });
  $('rFecha').textContent = fechaLarga();
  // Las 2.ª partes (barra y cocina) no cuentan como otro pedido.
  const nPedidos = hoy.filter(p => !p.parte_de).length;
  $('rPedidos').textContent = nPedidos;
  // Viajes ahorrados (v22): cada pedido que hace el cliente desde su móvil es una
  // ida y vuelta a la mesa para tomar nota que el camarero no ha tenido que hacer.
  // No cuentan los que mete el personal desde el panel ni las 2.ª partes.
  $('rViajes').textContent = hoy.filter(p => !p.parte_de && !p.desde_panel).length;
  $('rUnidades').textContent = unidades;
  $('rMedio').textContent = euros(nPedidos ? total / nPedidos : 0);
  $('rTotal').textContent = euros(total);
  const filas = Object.entries(porArticulo).sort((a, b) => b[1].cant - a[1].cant || b[1].importe - a[1].importe);
  $('rArticulos').innerHTML = filas.length
    ? filas.map(([n, a]) => `<div class="fila-dato"><span>${esc(n)}</span><span><b>${a.cant}×</b> · ${euros(a.importe)}</span></div>`).join('')
    : '<div class="vacio">Todavía no hay ventas hoy.</div>';
  const horas = {};
  hoy.forEach(p => { const h = new Date(p.creado).getHours(); horas[h] = (horas[h] || 0) + Number(p.total || 0); });
  const punta = Object.entries(horas).sort((a, b) => b[1] - a[1])[0];
  $('rPunta').textContent = punta ? 'Hora con más ventas: de ' + String(punta[0]).padStart(2, '0') + ':00 a ' + String((+punta[0] + 1) % 24).padStart(2, '0') + ':00 (' + euros(punta[1]) + ')' : '';
}

/* =====================================================================
   ABRIR MESAS (control de mesas, todo el personal)
   Con la opción del bar encendida, una mesa solo admite pedidos del QR
   cuando se abre aquí; se cierra sola a las horas fijadas o con "Cerrar".
   ===================================================================== */
async function cargarAbrir(){
  if(!estado.mesasAbrir) $('listaAbrir').innerHTML = '<div class="vacio">Cargando…</div>';
  try { estado.mesasAbrir = await datosPanel.mesasPanel() || []; pintarAbrir(); }
  catch(e) { tratarError(e); }
}
function pintarAbrir(){
  const ms = (estado.mesasAbrir || []).filter(m => m.activa);
  $('listaAbrir').innerHTML = ms.map(m => {
    const abierta = !!m.abierta_hasta;
    return `<div class="ficha mesa-abrir ${abierta ? 'abierta' : ''}">
      <div>
        <div class="ficha-titulo">${esc(m.nombre)}</div>
        <div class="ficha-detalle">${abierta ? '<span class="estado-mesa si">Abierta</span> · admite pedidos hasta las ' + hora(m.abierta_hasta) : '<span class="estado-mesa">Cerrada</span> · el QR no deja pedir'}</div>
      </div>
      <button class="btn ${abierta ? 'btn-borde' : 'btn-naranja'}" type="button" data-abrir="${m.id}" data-valor="${abierta ? 0 : 1}">${abierta ? 'Cerrar' : 'Abrir'}</button>
    </div>`;
  }).join('') || '<div class="vacio">No hay mesas activas.</div>';
}
$('listaAbrir').addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-abrir]');
  if(!b || b.disabled) return;
  b.disabled = true;
  try {
    const m = await datosPanel.abrirMesa(b.dataset.abrir, b.dataset.valor === '1');
    const i = (estado.mesasAbrir || []).findIndex(x => x.id === m.id);
    if(i >= 0) estado.mesasAbrir[i] = m;
    pintarAbrir();
    toast(m.abierta_hasta ? m.nombre + ' abierta' : m.nombre + ' cerrada');
  } catch(e) { b.disabled = false; tratarError(e); }
});

/* =====================================================================
   MESAS (admin)
   ===================================================================== */
async function cargarMesas(){
  $('listaMesas').innerHTML = '<div class="vacio">Cargando…</div>';
  try { estado.mesas = await datosPanel.mesas() || []; pintarMesas(); }
  catch(e) { $('listaMesas').innerHTML = ''; tratarError(e); }
}
function enlaceMesa(m){
  return new URL('../carta/?bar=' + encodeURIComponent(BAR) + '&mesa=' + m.id + '&c=' + encodeURIComponent(m.codigo), location.href).href;
}
function pintarMesas(){
  $('listaMesas').innerHTML = estado.mesas.map(m => `
    <div class="ficha">
      <div class="ficha-titulo">${esc(m.nombre)} ${m.activa ? '' : '<span class="chip">Desactivada: no admite pedidos</span>'}</div>
      <div class="ficha-detalle">Enlace de la carta: <b>${esc(enlaceMesa(m))}</b></div>
      <div class="ficha-botones">
        <button class="btn btn-borde" data-copiar="${m.id}" type="button">Copiar enlace</button>
        <button class="btn btn-borde" data-mesa="${m.id}" type="button">Editar</button>
      </div>
    </div>`).join('') || '<div class="vacio">Aún no has creado ninguna mesa.</div>';
}
$('listaMesas').addEventListener('click', async (ev) => {
  const c = ev.target.closest('[data-copiar]');
  if(c){
    const url = enlaceMesa(estado.mesas.find(m => m.id === Number(c.dataset.copiar)));
    try { await navigator.clipboard.writeText(url); toast('Enlace copiado'); }
    catch(e) { window.prompt('Copia este enlace:', url); }
    return;
  }
  const b = ev.target.closest('[data-mesa]');
  if(b) editarMesa(estado.mesas.find(m => m.id === Number(b.dataset.mesa)));
});

$('nuevaMesa').addEventListener('click', async () => {
  const id = estado.mesas.reduce((mx, x) => Math.max(mx, x.id), 0) + 1;
  const nombre = $('nombreMesaNueva').value.trim() || ('Mesa ' + id);
  const b = $('nuevaMesa'); b.disabled = true;
  try {
    await datosPanel.guardarMesa({ id, nombre, activa: true });
    $('nombreMesaNueva').value = '';
    toast('Mesa añadida: ' + nombre);
    cargarMesas();
  } catch(e) { tratarError(e); }
  b.disabled = false;
});

function editarMesa(m){
  abrirModal('Editar ' + m.nombre, [
    { id: 'nombre', etiqueta: 'Nombre (ej.: Mesa 5, Terraza 2)', valor: m.nombre },
    { id: 'activa', etiqueta: 'Admite pedidos', tipo: 'check', valor: m.activa },
    { id: 'nuevo_codigo', etiqueta: 'Cambiar el código secreto (habrá que reimprimir su QR)', tipo: 'check', valor: false },
  ], async (v) => {
    await datosPanel.guardarMesa({ id: m.id, nombre: v.nombre, activa: v.activa, nuevo_codigo: !!v.nuevo_codigo });
    toast(v.nuevo_codigo ? 'Código cambiado: reimprime el QR de esta mesa' : 'Mesa guardada');
    cargarMesas();
  });
}

/* =====================================================================
   USUARIOS (admin)
   ===================================================================== */
async function cargarUsuarios(){
  $('listaUsuarios').innerHTML = '<div class="vacio">Cargando…</div>';
  try { estado.usuarios = await datosPanel.usuarios() || []; pintarUsuarios(); }
  catch(e) { $('listaUsuarios').innerHTML = ''; tratarError(e); }
}
function pintarUsuarios(){
  $('listaUsuarios').innerHTML = estado.usuarios.map(u => `
    <div class="ficha">
      <div class="ficha-titulo">${esc(u.nombre)}</div>
      <div class="ficha-detalle">
        <span class="chip ${u.rol === 'admin' ? 'admin' : ''}">${esc(ROLES[u.rol] || u.rol)}</span>${u.activo ? '' : '<span class="chip">Desactivado</span>'}${u.bloqueado ? '<span class="chip">Bloqueado 15 min</span>' : ''}${u.cambiar_password ? '<span class="chip">Contraseña provisional</span>' : ''}
        <br>${esc(u.email)}
      </div>
      <div class="ficha-botones"><button class="btn btn-borde" data-usuario="${u.id}" type="button">Editar</button></div>
    </div>`).join('') || '<div class="vacio">No hay usuarios.</div>';
}
$('listaUsuarios').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-usuario]');
  if(b) editarUsuario(estado.usuarios.find(u => u.id === Number(b.dataset.usuario)));
});
$('nuevoUsuario').addEventListener('click', () => editarUsuario(null));

function passwordProvisional(){
  const w = ['Gamba', 'Marea', 'Puerto', 'Ancla', 'Coral', 'Ostra', 'Velero', 'Faro'];
  const r = crypto.getRandomValues(new Uint32Array(3));
  return w[r[0] % w.length] + '-' + (1000 + r[1] % 9000) + '-' + (r[2] % 0x10000).toString(16).padStart(4, '0');
}

function editarUsuario(u){
  const nuevo = !u;
  u = u || { nombre: '', email: '', rol: 'camarero', activo: true };
  const campos = [
    { id: 'nombre', etiqueta: 'Nombre', valor: u.nombre },
    { id: 'email', etiqueta: 'Correo (para entrar)', valor: u.email, tipo: 'email' },
    { id: 'rol', etiqueta: 'Rol', tipo: 'select', valor: u.rol, opciones: Object.entries(ROLES) },
  ];
  if(!nuevo) campos.push({ id: 'activo', etiqueta: 'Activo (puede entrar)', tipo: 'check', valor: u.activo });
  campos.push({ id: 'password', etiqueta: nuevo ? 'Contraseña provisional (dásela a la persona)' : 'Poner contraseña provisional nueva (déjalo vacío para no cambiarla)',
    valor: nuevo ? passwordProvisional() : '', ayuda: 'Al entrar le pedirá cambiarla. Mínimo 8 caracteres.' });
  abrirModal(nuevo ? 'Nuevo usuario' : 'Editar usuario', campos, async (v) => {
    const datos = { nombre: v.nombre, email: v.email, rol: v.rol };
    if(!nuevo){ datos.id = u.id; datos.activo = v.activo; }
    if(v.password) datos.password = v.password;
    await datosPanel.guardarUsuario(datos);
    toast(v.password ? 'Guardado. Contraseña provisional: ' + v.password : 'Usuario guardado');
    cargarUsuarios();
  });
}

/* =====================================================================
   VENTANA DE EDICIÓN
   ===================================================================== */
let alGuardar = null;
function abrirModal(titulo, campos, guardar){
  estado.alTocarModal = null;
  $('modalForm').querySelector('[type=submit]').hidden = false;
  $('modalTitulo').textContent = titulo;
  $('modalError').hidden = true;
  $('modalCampos').innerHTML = campos.map(c => {
    const id = 'm_' + c.id;
    if(c.tipo === 'check') return `<label class="campo campo-check"><input type="checkbox" id="${id}" ${c.valor ? 'checked' : ''}><span>${esc(c.etiqueta)}</span></label>`;
    if(c.tipo === 'select') return `<label class="campo"><span>${esc(c.etiqueta)}</span><select id="${id}">${c.opciones.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(c.valor) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
    const extra = c.tipo === 'decimal' ? 'inputmode="decimal"' : c.tipo === 'email' ? 'type="email" inputmode="email" autocapitalize="off"' : '';
    return `<label class="campo"><span>${esc(c.etiqueta)}</span><input id="${id}" ${extra} value="${esc(c.valor)}" autocomplete="off">${c.ayuda ? `<small>${esc(c.ayuda)}</small>` : ''}</label>`;
  }).join('');
  alGuardar = async () => {
    const v = {};
    campos.forEach(c => { const el = $('m_' + c.id); v[c.id] = c.tipo === 'check' ? el.checked : el.value.trim(); });
    await guardar(v);
  };
  $('modal').hidden = false;
}
// Ventana con contenido propio (p. ej. modificar un pedido).
function abrirModalLibre(titulo, pintar, guardar){
  $('modalForm').querySelector('[type=submit]').hidden = !guardar;
  $('modalTitulo').textContent = titulo;
  $('modalError').hidden = true;
  pintar();
  alGuardar = guardar;
  $('modal').hidden = false;
}
$('modalCampos').addEventListener('click', (ev) => { if(estado.alTocarModal) estado.alTocarModal(ev); });
function cerrarModal(){
  $('modal').hidden = true; alGuardar = null; estado.alTocarModal = null;
  $('modalForm').querySelector('[type=submit]').textContent = 'Guardar';
}
// Ventana de confirmación (cobrar, reabrir): título, texto, botón y lo que hace.
function confirmarAccion(titulo, html, textoBoton, accion){
  abrirModalLibre(titulo, () => { $('modalCampos').innerHTML = html; }, accion);
  $('modalForm').querySelector('[type=submit]').textContent = textoBoton;
}
$('modalCancelar').addEventListener('click', cerrarModal);
$('modal').addEventListener('click', (ev) => { if(ev.target === $('modal')) cerrarModal(); });
$('modalForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if(!alGuardar) return;
  const boton = ev.submitter || $('modalForm').querySelector('[type=submit]');
  boton.disabled = true;
  try { await alGuardar(); cerrarModal(); }
  catch(e) {
    if(e.codigo === 'SESION_CADUCADA'){ cerrarModal(); return volverAlLogin(e.message); }
    $('modalError').textContent = e.message; $('modalError').hidden = false;
  } finally { boton.disabled = false; }
});

/* Ver la contraseña al escribirla (v28): un ojo a la derecha de cada campo de
   contraseña. Al enviar el formulario se vuelve a ocultar. */
const OJO_ABIERTO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const OJO_CERRADO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7c1.9 0 3.5-.5 4.9-1.3M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
function ponerOjos(){
  document.querySelectorAll('input[type="password"]').forEach((input) => {
    if(input.parentNode.classList.contains('con-ojo')) return;
    const caja = document.createElement('span');
    caja.className = 'con-ojo';
    input.parentNode.insertBefore(caja, input);
    caja.appendChild(input);
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ojo';
    const pintar = () => {
      const visible = input.type === 'text';
      b.innerHTML = visible ? OJO_CERRADO : OJO_ABIERTO;
      b.setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
    };
    b.addEventListener('click', (ev) => {
      ev.preventDefault();
      input.type = input.type === 'password' ? 'text' : 'password';
      pintar();
    });
    if(input.form) input.form.addEventListener('submit', () => { input.type = 'password'; pintar(); });
    pintar();
    caja.appendChild(b);
  });
}
ponerOjos();

pintarBarDelEnlace();
arrancar();
