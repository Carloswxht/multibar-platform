/* =====================================================================
   MultiBar · Plataforma (v27): el panel de autonomIA Lab para administrar
   los bares. Lista de bares con sus números, ficha con las opciones,
   dar de baja o reactivar y alta de un bar nuevo. Entrega 2 (v29): aspecto
   de la carta con vista previa, datos del bar y aviso legal, y personal.
   Todo pasa por las funciones plataforma_* de la base (comun/datos.js →
   datosPlataforma), que solo aceptan la sesión de la cuenta de plataforma.
   Navegación por la dirección (#):  vacío → bares · #bar/ID → ficha ·
   #bar/ID/aspecto · #bar/ID/datos · #bar/ID/persona(/UID) ·
   #nuevo → alta · #recuperar=CÓDIGO → elegir contraseña (enlace del correo).
   ===================================================================== */

const $ = (id) => document.getElementById(id);
const VISTAS = ['vEntrar', 'vOlvido', 'vNueva', 'vBares', 'vFicha', 'vAlta', 'vHecho', 'vAspecto', 'vDatos', 'vPersona'];

// Las opciones que se encienden por bar (todas apagadas al dar de alta).
const OPCIONES = [
  { k: 'barra_cocina', t: 'Barra y cocina', d: 'Cada pestaña va a barra o a cocina; el panel filtra y cada parte lleva su estado.' },
  { k: 'avisos_mesa', t: 'Llamar al camarero', d: 'Botón «Camarero» en la carta: llamar o pedir la cuenta desde la mesa.' },
  { k: 'cuentas_mesa', t: 'Cuentas de mesas', d: 'Vista en el panel con lo pedido por mesa y el botón «Cobrada».' },
  { k: 'control_mesas', t: 'Control de mesas', d: 'El QR solo deja pedir cuando el personal abre la mesa en el panel.' },
  { k: 'destacados', t: 'Recomendados', d: 'Etiquetas Plato del día, Recomendado y Nuevo, y pestaña «★ Recomendados».' },
  { k: 'horarios', t: 'Carta por horario', d: 'Cada pestaña puede tener sus días y horas (desayunos, menú del día…).' },
  { k: 'fotos', t: 'Fotos de los productos', d: 'El admin del bar sube fotos desde su panel y salen en la carta.' },
  // Carta más fácil (v30)
  { k: 'otra_ronda', t: 'Otra ronda', d: 'Botón «Otra igual» para repetir el último pedido con un toque.' },
  { k: 'alergenos', t: 'Alérgenos', d: 'Iconos en cada plato y «¿Alergias?» para avisar de lo que no puede tomar. El admin los marca en su panel.' },
  { k: 'mas_pedidos', t: 'Lo más pedido', d: 'Primera pestaña «Lo mejor» con lo más pedido en 30 días y los recomendados.' },
  { k: 'carta_hora', t: 'Carta según la hora', d: 'Primero las pestañas que se sirven ahora. Necesita «Carta por horario».' },
  { k: 'bienvenida', t: 'Bienvenida', d: 'La primera vez, tres pasos: elige, envía y pagas al final.' },
  { k: 'raciones', t: 'Raciones', d: '«Para 2–3 personas» junto al precio. El admin lo escribe en su panel.' },
];
const ROLES = { admin: 'Admin', barra: 'Barra', camarero: 'Camarero' };

/* ---------- Ayudas ---------- */
function esc(t){
  return String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function euros(n){
  return Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
function hace(fecha){
  if(!fecha) return 'nunca';
  const s = Math.max(0, (Date.now() - new Date(fecha).getTime()) / 1000);
  if(s < 90) return 'hace un momento';
  if(s < 3600) return 'hace ' + Math.round(s / 60) + ' min';
  if(s < 86400) return 'hace ' + Math.round(s / 3600) + ' h';
  const d = Math.round(s / 86400);
  return d === 1 ? 'ayer' : 'hace ' + d + ' días';
}
function fechaCorta(f){
  return f ? new Date(f).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}
let relojToast = null;
function toast(texto, mal){
  const t = $('toast');
  t.textContent = texto;
  t.classList.toggle('mal', !!mal);
  t.hidden = false;
  clearTimeout(relojToast);
  relojToast = setTimeout(() => { t.hidden = true; }, mal ? 4500 : 2600);
}
function mostrar(id){
  VISTAS.forEach((v) => { $(v).hidden = v !== id; });
  $('bSalir').hidden = !datosPlataforma.sesion() || ['vEntrar', 'vOlvido', 'vNueva'].includes(id);
  window.scrollTo(0, 0);
}
function cargando(cont){ cont.innerHTML = '<p class="cargando">Cargando…</p>'; }
function verError(el, codigo){ el.textContent = textoError(codigo); el.hidden = false; }

// Si la sesión ha caducado (o la base no la reconoce), a la pantalla de entrar.
function fallo(e){
  if(e && e.codigo === 'SESION_CADUCADA'){ mostrar('vEntrar'); toast('La sesión ha caducado. Vuelve a entrar.', true); return true; }
  toast(textoError(e && e.codigo), true);
  return false;
}

// Ventana de confirmación: devuelve una promesa con true / false.
// El botón de «sí» es rojo para lo que apaga algo (dar de baja) y azul para lo demás.
function confirmar(titulo, texto, si, rojo){
  return new Promise((ok) => {
    $('dTitulo').textContent = titulo;
    $('dTexto').textContent = texto;
    $('dSi').textContent = si;
    $('dSi').className = 'btn ' + (rojo ? 'btn-rojo lleno' : 'btn-azul');
    $('dialogo').hidden = false;
    const fin = (r) => { $('dialogo').hidden = true; $('dSi').onclick = $('dNo').onclick = null; ok(r); };
    $('dSi').onclick = () => fin(true);
    $('dNo').onclick = () => fin(false);
  });
}

/* ---------- Navegación ---------- */
async function irA(){
  const h = location.hash.replace(/^#/, '');
  if(h.startsWith('recuperar=')){ mostrar('vNueva'); return; }
  if(!datosPlataforma.sesion()){ mostrar('vEntrar'); return; }
  if(salirSinGuardar && !(await salirSinGuardar())) return;
  let m = h.match(/^bar\/(\d+)$/);
  if(m) return verFicha(m[1]);
  if((m = h.match(/^bar\/(\d+)\/aspecto$/))) return verAspecto(m[1]);
  if((m = h.match(/^bar\/(\d+)\/datos$/))) return verDatos(m[1]);
  if((m = h.match(/^bar\/(\d+)\/persona(?:\/(\d+))?$/))) return verPersona(m[1], m[2]);
  if(h === 'nuevo') return verAlta();
  return verBares();
}
window.addEventListener('hashchange', irA);
document.querySelectorAll('[data-ir="entrar"]').forEach((b) => b.addEventListener('click', () => mostrar('vEntrar')));

/* ---------- Entrar, salir y contraseña ---------- */
$('fEntrar').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const b = ev.submitter || $('fEntrar').querySelector('button[type=submit]');
  $('eError').hidden = true;
  const email = $('eEmail').value.trim(), pass = $('ePass').value;
  if(!email || !pass){ verError($('eError'), 'CREDENCIALES'); return; }
  b.disabled = true;
  try {
    await datosPlataforma.entrar(email, pass);
    $('ePass').value = '';
    if(location.hash) location.hash = ''; else irA();
  } catch(e) { verError($('eError'), e.codigo); }
  finally { b.disabled = false; }
});

$('bOlvido').addEventListener('click', () => {
  $('oEmail').value = $('eEmail').value.trim();
  $('oHecho').hidden = true;
  mostrar('vOlvido');
});

$('fOlvido').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const email = $('oEmail').value.trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ toast(textoError('EMAIL_NO_VALIDO'), true); return; }
  const b = $('fOlvido').querySelector('button[type=submit]');
  b.disabled = true;
  try { await datosPlataforma.enlaceContrasena(email); $('oHecho').hidden = false; }
  catch(e) { toast(textoError(e.codigo), true); }
  finally { b.disabled = false; }
});

$('fNueva').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  $('nError').hidden = true;
  const p1 = $('nPass').value, p2 = $('nPass2').value;
  if(p1.length < 8){ verError($('nError'), 'PASSWORD_CORTA'); return; }
  if(p1 !== p2){ $('nError').textContent = 'Las dos contraseñas no coinciden.'; $('nError').hidden = false; return; }
  const token = location.hash.replace(/^#recuperar=/, '');
  const b = $('fNueva').querySelector('button[type=submit]');
  b.disabled = true;
  try {
    await datosPlataforma.restablecer(token, p1);
    $('nPass').value = $('nPass2').value = '';
    history.replaceState(null, '', location.pathname + location.search);
    mostrar('vEntrar');
    toast('Contraseña guardada. Ya puedes entrar.');
  } catch(e) { verError($('nError'), e.codigo); }
  finally { b.disabled = false; }
});

$('bSalir').addEventListener('click', async () => {
  await datosPlataforma.salir();
  history.replaceState(null, '', location.pathname + location.search);
  mostrar('vEntrar');
});

/* ---------- Lista de bares ---------- */
let bares = [];

async function verBares(){
  mostrar('vBares');
  $('bResumen').innerHTML = '';
  cargando($('bLista'));
  try { bares = await datosPlataforma.bares() || []; }
  catch(e) { fallo(e); $('bLista').innerHTML = '<p class="vacio">No se han podido cargar los bares.</p>'; return; }
  const activos = bares.filter((b) => b.activo);
  const suma = (k) => activos.reduce((s, b) => s + Number((b.stats || {})[k] || 0), 0);
  $('bResumen').innerHTML =
    `<div class="dato"><b>${activos.length}</b><span>bares activos</span></div>` +
    `<div class="dato"><b>${suma('pedidos_hoy')}</b><span>pedidos hoy</span></div>` +
    `<div class="dato azul"><b>${suma('viajes_hoy')}</b><span>viajes ahorrados hoy</span></div>`;
  if(!bares.length){ $('bLista').innerHTML = '<p class="vacio">Aún no hay bares. Toca «+ Nuevo bar».</p>'; return; }
  $('bLista').innerHTML = bares.map((b) => {
    const s = b.stats || {};
    return `<a class="tarjeta${b.activo ? '' : ' baja'}" href="#bar/${b.id}">
      <div class="t-arriba"><span class="t-nombre">${esc(b.nombre)}</span>${chip(b.activo)}</div>
      <div class="t-slug">${esc(b.slug)} · ${b.mesas} mesas</div>
      <div class="t-numeros">
        <span>HOY <b>${s.pedidos_hoy || 0}</b> pedidos</span>
        <span class="azul"><b>${s.viajes_hoy || 0}</b> viajes</span>
        <span><b>${euros(s.ventas_hoy)}</b></span>
      </div>
      <div class="t-numeros">
        <span>7 DÍAS <b>${s.pedidos_7d || 0}</b> pedidos</span>
        <span class="azul"><b>${s.viajes_7d || 0}</b> viajes</span>
        <span><b>${euros(s.ventas_7d)}</b></span>
      </div>
      <div class="t-ultimo">Último pedido: ${hace(s.ultimo)}</div>
    </a>`;
  }).join('');
}
function chip(activo){ return activo ? '<span class="chip">Activo</span>' : '<span class="chip baja">De baja</span>'; }

/* ---------- Ficha de un bar ---------- */
async function verFicha(id){
  mostrar('vFicha');
  const cont = $('fContenido');
  cargando(cont);
  let b;
  try { b = await datosPlataforma.bar(id); }
  catch(e) { fallo(e); cont.innerHTML = '<p class="vacio">No se ha podido abrir este bar.</p>'; return; }
  fichaActual = b;
  const a = b.ajustes || {}, s = b.stats || {};
  const asp = a.aspecto || {}, col = Object.assign({}, COLOR_DEFECTO, asp.colores || {});
  const legal = a.legal || {};
  const carta = '../carta/?bar=' + encodeURIComponent(b.slug);
  const panel = '../panel/?bar=' + encodeURIComponent(b.slug);
  const horas = Number(a.horas_mesa) || 4;
  cont.innerHTML = `
    <div class="f-cabeza">
      <div class="t-arriba"><h1>${esc(b.nombre)}</h1>${chip(b.activo)}</div>
      <div class="t-slug">${esc(b.slug)}</div>
      <div class="f-meta">${b.mesas} mesas · ${b.productos} productos · alta el ${fechaCorta(b.alta)}${!b.activo && b.baja ? ' · de baja desde el ' + fechaCorta(b.baja) : ''}</div>
    </div>
    <div class="f-enlaces">
      <a class="btn btn-borde" href="${carta}" target="_blank" rel="noopener">Abrir carta ↗</a>
      <a class="btn btn-borde" href="${panel}" target="_blank" rel="noopener">Abrir panel ↗</a>
    </div>

    <div class="seccion">
      <h2>Hoy</h2>
      <div class="numeros">
        <div class="dato"><b>${s.pedidos_hoy || 0}</b><span>pedidos</span></div>
        <div class="dato azul"><b>${s.viajes_hoy || 0}</b><span>viajes ahorrados</span></div>
        <div class="dato dinero"><b>${euros(s.ventas_hoy)}</b><span>ventas</span></div>
      </div>
      <h2>Últimos 7 días</h2>
      <div class="numeros">
        <div class="dato"><b>${s.pedidos_7d || 0}</b><span>pedidos</span></div>
        <div class="dato azul"><b>${s.viajes_7d || 0}</b><span>viajes ahorrados</span></div>
        <div class="dato dinero"><b>${euros(s.ventas_7d)}</b><span>ventas</span></div>
      </div>
      <p class="nota">Último pedido: ${hace(s.ultimo)}.</p>
    </div>

    <div class="seccion">
      <h2>Opciones</h2>
      <p class="nota">Se guardan al momento. La carta y el panel del bar las ven en un minuto.</p>
      <div class="opciones">
        ${OPCIONES.map((o) => `
        <div class="opcion">
          <div class="op-texto"><b>${o.t}</b><span>${o.d}</span>
            ${o.k === 'control_mesas' ? `<label class="op-extra">Se cierra sola a las
              <select data-horas>${Array.from({ length: 24 }, (_, i) => i + 1).map((n) => `<option value="${n}"${n === horas ? ' selected' : ''}>${n}</option>`).join('')}</select> h</label>` : ''}
          </div>
          <label class="interruptor"><input type="checkbox" data-op="${o.k}"${a[o.k] === true ? ' checked' : ''} aria-label="${o.t}"><span></span></label>
        </div>`).join('')}
        <div class="opcion">
          <div class="op-texto"><b>Numeración continua</b><span>El nº de pedido no vuelve a 1 cada día.</span></div>
          <label class="interruptor"><input type="checkbox" data-num${a.numeracion === 'continua' ? ' checked' : ''} aria-label="Numeración continua"><span></span></label>
        </div>
      </div>
    </div>

    <div class="seccion">
      <h2>Aspecto y datos</h2>
      <a class="tarjeta enlace-ficha" href="#bar/${b.id}/aspecto">
        <div class="t-arriba"><b>Aspecto de la carta</b><span class="muestras">${['principal', 'acento', 'fondo', 'texto'].map((k) => `<i style="background:${esc(col[k])}"></i>`).join('')}</span></div>
        <span class="t-ultimo">${asp.colores || asp.fuentes || asp.logo ? 'Colores, letras' + (asp.logo ? ', logo' : '') + ' y textos propios' : 'Aspecto neutro de MultiBar'} · Cambiar con vista previa →</span>
      </a>
      <a class="tarjeta enlace-ficha" href="#bar/${b.id}/datos">
        <div class="t-arriba"><b>Datos del bar y aviso legal</b></div>
        <span class="t-ultimo">${legal.titular ? 'Titular: ' + esc(legal.titular) : 'Sin titular: la carta no enseña el aviso legal'} · Cambiar →</span>
      </a>
    </div>

    <div class="seccion">
      <h2>Personal</h2>
      <p class="nota">«Mandar enlace» le manda un correo para elegir contraseña (a quien no ha entrado nunca, el de bienvenida). Toca el nombre para cambiar su rol o desactivarlo.</p>
      <div class="personas">
        ${(b.usuarios || []).length ? b.usuarios.map((u) => `
        <div class="persona">
          <a class="p-texto" href="#bar/${b.id}/persona/${u.id}"><b>${esc(u.nombre)} <span class="p-rol">${esc(ROLES[u.rol] || u.rol)}</span></b>
            <span>${esc(u.email)}</span>
            ${!u.activo ? '<span>Desactivado</span>' : u.pendiente ? '<span class="p-pend">Aún no ha elegido contraseña</span>' : ''}</a>
          ${u.activo ? `<button class="btn btn-borde" type="button" data-enlace="${esc(u.email)}" data-pendiente="${u.pendiente ? 1 : 0}">Mandar enlace</button>` : ''}
        </div>`).join('') : '<p class="vacio">Sin personal.</p>'}
      </div>
      <a class="btn btn-borde" href="#bar/${b.id}/persona">+ Añadir persona</a>
    </div>

    <div class="seccion">
      <h2>${b.activo ? 'Dar de baja' : 'Reactivar'}</h2>
      <p class="nota">${b.activo
        ? 'La carta deja de abrirse y nadie del bar puede entrar en el panel. No se borra nada: se puede reactivar.'
        : 'La carta y el panel vuelven a funcionar con todo lo que tenía.'}</p>
      <button class="btn ${b.activo ? 'btn-rojo' : 'btn-azul'}" type="button" id="bEstado">${b.activo ? 'Dar de baja ' + esc(b.nombre) : 'Reactivar ' + esc(b.nombre)}</button>
    </div>`;

  // Interruptores: se guardan al tocar; si falla, vuelven a como estaban.
  async function guardar(cambio, input){
    input.disabled = true;
    try { await datosPlataforma.opciones(b.id, cambio); toast('Guardado'); }
    catch(e) { if(input.type === 'checkbox') input.checked = !input.checked; fallo(e); }
    finally { input.disabled = false; }
  }
  cont.querySelectorAll('[data-op]').forEach((i) => i.addEventListener('change', () => guardar({ [i.dataset.op]: i.checked }, i)));
  cont.querySelector('[data-num]').addEventListener('change', (ev) => guardar({ numeracion: ev.target.checked ? 'continua' : 'diaria' }, ev.target));
  const sel = cont.querySelector('[data-horas]');
  let horasAntes = sel.value;
  sel.addEventListener('change', async () => {
    sel.disabled = true;
    try { await datosPlataforma.opciones(b.id, { horas_mesa: Number(sel.value) }); horasAntes = sel.value; toast('Guardado'); }
    catch(e) { sel.value = horasAntes; fallo(e); }
    finally { sel.disabled = false; }
  });

  cont.querySelectorAll('[data-enlace]').forEach((btn) => btn.addEventListener('click', async () => {
    const email = btn.dataset.enlace, pendiente = btn.dataset.pendiente === '1';
    const ok = await confirmar('¿Mandar enlace?', `Le llegará a ${email} un correo para elegir ${pendiente ? 'su' : 'una nueva'} contraseña.`, 'Mandar');
    if(!ok) return;
    btn.disabled = true;
    try {
      await (pendiente ? datosPlataforma.bienvenida(email) : datosPlataforma.enlaceContrasena(email));
      toast('Correo enviado a ' + email);
      // Vuelve a leer la ficha: si ya eligió contraseña, deja de salir «pendiente».
      setTimeout(() => { if(location.hash === '#bar/' + b.id) verFicha(b.id); }, 1500);
    } catch(e) { fallo(e); }
    finally { btn.disabled = false; }
  }));

  $('bEstado').addEventListener('click', async () => {
    const ok = b.activo
      ? await confirmar('¿Dar de baja ' + b.nombre + '?', 'Su carta deja de abrirse y su personal no podrá entrar en el panel. No se borra nada.', 'Sí, dar de baja', true)
      : await confirmar('¿Reactivar ' + b.nombre + '?', 'Su carta y su panel vuelven a funcionar.', 'Sí, reactivar');
    if(!ok) return;
    $('bEstado').disabled = true;
    try {
      await datosPlataforma.estado(b.id, !b.activo);
      toast(b.activo ? 'Dado de baja' : 'Reactivado');
      verFicha(b.id);
    } catch(e) { fallo(e); $('bEstado').disabled = false; }
  });
}

/* ---------- Ficha en memoria (para las pantallas de aspecto, datos y personal) ---------- */
let fichaActual = null;
async function ficha(id){
  if(fichaActual && String(fichaActual.id) === String(id)) return fichaActual;
  fichaActual = await datosPlataforma.bar(id);
  return fichaActual;
}
// Si hay cambios sin guardar en el aspecto, se pregunta antes de salir.
let salirSinGuardar = null;

/* ---------- Aspecto de la carta (v29) ---------- */
const COLOR_DEFECTO = { principal: '#22262E', acento: '#D9822B', fondo: '#FFFFFF', texto: '#1C2028' };
const COLORES = [
  ['principal', 'Color principal', 'Cabecera, barra de abajo y títulos'],
  ['acento', 'Color de acento', 'Botones +, «Ver tique» y rayas'],
  ['fondo', 'Fondo', 'Fondo de la carta'],
  ['texto', 'Texto', 'Letra de los productos'],
];
// Al cambiar un color, su tono derivado se vuelve a calcular solo.
const DERIVADO = { principal: 'principal_oscuro', acento: 'acento_oscuro', fondo: 'fondo_2' };
const PALETAS = [
  { n: 'MultiBar', c: { principal: '#22262E', acento: '#D9822B', fondo: '#FFFFFF', texto: '#1C2028' } },
  { n: 'Marino', c: { principal: '#14295E', acento: '#F08A3E', fondo: '#FFFFFF', texto: '#0F1E45' } },
  { n: 'Verde', c: { principal: '#1F4D3A', acento: '#D4A017', fondo: '#FFFFFF', texto: '#16261F' } },
  { n: 'Granate', c: { principal: '#5E1A24', acento: '#C9A227', fondo: '#FFFBF5', texto: '#2A1215' } },
  { n: 'Negro', c: { principal: '#111111', acento: '#F2C230', fondo: '#FFFFFF', texto: '#151515' } },
  { n: 'Terracota', c: { principal: '#7A3B23', acento: '#E07A3F', fondo: '#FFF8F1', texto: '#3A1E12' } },
  { n: 'Azul mar', c: { principal: '#0B5E7E', acento: '#F4B43A', fondo: '#FFFFFF', texto: '#0C2A36' } },
];
const NOMBRES_FUENTES = {
  oswald: 'Oswald · alta y estrecha', dmsans: 'DM Sans · moderna', playfair: 'Playfair · elegante',
  lora: 'Lora · clásica', montserrat: 'Montserrat · redonda', bebas: 'Bebas · solo mayúsculas',
  robotoslab: 'Roboto Slab · de imprenta', nunito: 'Nunito · amable', sistema: 'La del móvil',
};
const TEXTOS_CARTA = {
  ver_tique: 'Botón del tique', tu_tique: 'Título del tique', total: 'Total',
  enviar: 'Botón de enviar el pedido', pie_mirar: 'Pie del tique (sin QR de mesa)',
  pie_pedir: 'Pie del tique (con QR de mesa)', tique_vacio: 'Tique vacío',
};

async function verAspecto(id){
  mostrar('vAspecto');
  const cont = $('aspContenido');
  cargando(cont);
  let b;
  try { b = await ficha(id); }
  catch(e) { fallo(e); cont.innerHTML = '<p class="vacio">No se ha podido abrir este bar.</p>'; return; }
  const guardado = JSON.parse(JSON.stringify((b.ajustes && b.ajustes.aspecto) || {}));
  let borrador = JSON.parse(JSON.stringify(guardado));
  let cambios = false;
  const fuentes = (window.Aspecto && Aspecto.FUENTES) || Object.keys(NOMBRES_FUENTES);
  const textosDefecto = (window.Aspecto && Aspecto.TEXTOS) || {};

  cont.innerHTML = `
    <a class="volver" href="#bar/${b.id}">← ${esc(b.nombre)}</a>
    <div><p class="eti">Aspecto</p><h1>${esc(b.nombre)}</h1></div>
    <div class="previa" id="aspPrevia">
      <div class="previa-marco"><iframe id="aspFrame" title="Vista previa de la carta" src="../carta/?bar=${encodeURIComponent(b.slug)}"></iframe></div>
      <span class="previa-eti">Vista previa <button type="button" id="aspPlegar">Ocultar</button></span>
    </div>

    <div class="seccion">
      <h2>Combinaciones rápidas</h2>
      <div class="paletas">${PALETAS.map((p, i) => `<button type="button" class="paleta" data-paleta="${i}">
        <span>${['principal', 'acento', 'fondo'].map((k) => `<i style="background:${p.c[k]}"></i>`).join('')}</span>${esc(p.n)}</button>`).join('')}</div>
    </div>

    <div class="seccion">
      <h2>Colores</h2>
      <div class="opciones">${COLORES.map(([k, t, d]) => `
        <label class="opcion fila-color">
          <div class="op-texto"><b>${t}</b><span>${d}</span></div>
          <input type="text" class="hex mono" data-hex="${k}" maxlength="7" spellcheck="false" autocapitalize="characters">
          <input type="color" data-color="${k}" aria-label="${t}">
        </label>`).join('')}
      </div>
    </div>

    <div class="seccion">
      <h2>Letras</h2>
      <div class="caja form">
        <label class="campo"><span>Títulos y nombre del bar</span><select id="aspTitulos">${fuentes.map((f) => `<option value="${f}">${esc(NOMBRES_FUENTES[f] || f)}</option>`).join('')}</select></label>
        <label class="campo"><span>Texto de los productos</span><select id="aspTexto">${fuentes.map((f) => `<option value="${f}">${esc(NOMBRES_FUENTES[f] || f)}</option>`).join('')}</select></label>
      </div>
    </div>

    <div class="seccion">
      <h2>Logo</h2>
      <div class="caja form">
        <div class="logo-caja"><div class="logo-ver" id="aspLogoVer"></div>
          <div class="logo-botones">
            <label class="btn btn-borde btn-peq">Subir logo<input type="file" id="aspLogoArchivo" accept="image/png,image/jpeg,image/webp" hidden></label>
            <button class="btn btn-rojo btn-peq" type="button" id="aspLogoQuitar">Quitar</button>
          </div></div>
        <p class="nota-campo">PNG con fondo transparente queda mejor. Se reduce solo en el móvil antes de subirlo.</p>
        <label class="campo" id="aspCabeceraCampo"><span>En la cabecera</span><select id="aspCabecera">
          <option value="logo_y_nombre">Logo y nombre</option><option value="logo">Solo el logo</option><option value="nombre">Solo el nombre</option></select></label>
      </div>
    </div>

    <div class="seccion">
      <h2>Textos de la carta</h2>
      <p class="nota">Vacío = el de MultiBar (el que se ve en gris).</p>
      <div class="caja form">${Object.keys(TEXTOS_CARTA).map((k) => `
        <label class="campo"><span>${TEXTOS_CARTA[k]}</span><input data-texto="${k}" maxlength="120" placeholder="${esc(textosDefecto[k] || '')}"></label>`).join('')}
        <label class="campo"><span>Nombre bajo el icono al instalar la carta</span><input id="aspCorto" maxlength="30" placeholder="${esc(b.nombre)}"></label>
      </div>
    </div>

    <div class="barra-guardar">
      <button class="btn btn-borde" type="button" id="aspDeshacer" disabled>Deshacer</button>
      <button class="btn btn-azul" type="button" id="aspGuardar" disabled>Guardar aspecto</button>
    </div>`;

  // La vista previa se puede plegar para tener más sitio en el móvil.
  $('aspPlegar').addEventListener('click', () => {
    const p = $('aspPrevia').classList.toggle('plegada');
    $('aspPlegar').textContent = p ? 'Ver vista previa' : 'Ocultar';
  });
  const frame = $('aspFrame');
  let relojPrevia = null;
  function enviarPrevia(){
    clearTimeout(relojPrevia);
    relojPrevia = setTimeout(() => {
      try { frame.contentWindow.postMessage({ tipo: 'mb-vista-previa', aspecto: borrador }, location.origin); } catch(e) { /* aún cargando */ }
    }, 120);
  }
  frame.addEventListener('load', () => { enviarPrevia(); setTimeout(enviarPrevia, 1500); });

  function marcar(){
    cambios = JSON.stringify(borrador) !== JSON.stringify(guardado);
    $('aspGuardar').disabled = !cambios;
    $('aspDeshacer').disabled = !cambios;
    enviarPrevia();
  }
  function pintar(){
    const c = Object.assign({}, COLOR_DEFECTO, borrador.colores || {});
    cont.querySelectorAll('[data-color]').forEach((i) => { i.value = c[i.dataset.color].toLowerCase(); });
    cont.querySelectorAll('[data-hex]').forEach((i) => { i.value = c[i.dataset.hex].toUpperCase(); i.classList.remove('mal'); });
    const f = borrador.fuentes || {};
    $('aspTitulos').value = f.titulos || 'oswald';
    $('aspTexto').value = f.texto || 'dmsans';
    $('aspLogoVer').innerHTML = borrador.logo ? `<img src="${esc(urlLogo(borrador.logo))}" alt="Logo">` : '<span>Sin logo</span>';
    $('aspLogoQuitar').hidden = !borrador.logo;
    $('aspCabeceraCampo').hidden = !borrador.logo;
    $('aspCabecera').value = borrador.cabecera || 'logo_y_nombre';
    cont.querySelectorAll('[data-texto]').forEach((i) => { i.value = (borrador.textos || {})[i.dataset.texto] || ''; });
    $('aspCorto').value = borrador.nombre_corto || '';
  }
  function ponerColor(k, v){
    borrador.colores = Object.assign({}, borrador.colores || {}, { [k]: v.toUpperCase() });
    if(DERIVADO[k]) delete borrador.colores[DERIVADO[k]];
  }

  cont.querySelectorAll('[data-paleta]').forEach((btn) => btn.addEventListener('click', () => {
    const p = PALETAS[Number(btn.dataset.paleta)];
    Object.keys(p.c).forEach((k) => ponerColor(k, p.c[k]));
    pintar(); marcar();
  }));
  cont.querySelectorAll('[data-color]').forEach((i) => i.addEventListener('input', () => {
    ponerColor(i.dataset.color, i.value);
    cont.querySelector(`[data-hex="${i.dataset.color}"]`).value = i.value.toUpperCase();
    marcar();
  }));
  cont.querySelectorAll('[data-hex]').forEach((i) => i.addEventListener('input', () => {
    let v = i.value.trim().toUpperCase();
    if(v && v[0] !== '#') v = '#' + v;
    const ok = /^#[0-9A-F]{6}$/.test(v);
    i.classList.toggle('mal', !ok);
    if(!ok) return;
    ponerColor(i.dataset.hex, v);
    cont.querySelector(`[data-color="${i.dataset.hex}"]`).value = v.toLowerCase();
    marcar();
  }));
  $('aspTitulos').addEventListener('change', () => { borrador.fuentes = Object.assign({}, borrador.fuentes, { titulos: $('aspTitulos').value }); marcar(); });
  $('aspTexto').addEventListener('change', () => { borrador.fuentes = Object.assign({}, borrador.fuentes, { texto: $('aspTexto').value }); marcar(); });
  $('aspCabecera').addEventListener('change', () => { borrador.cabecera = $('aspCabecera').value; marcar(); });
  cont.querySelectorAll('[data-texto]').forEach((i) => i.addEventListener('input', () => {
    const t = Object.assign({}, borrador.textos || {});
    if(i.value.trim()) t[i.dataset.texto] = i.value; else delete t[i.dataset.texto];
    borrador.textos = t;
    if(!Object.keys(t).length) delete borrador.textos;
    marcar();
  }));
  $('aspCorto').addEventListener('input', () => {
    if($('aspCorto').value.trim()) borrador.nombre_corto = $('aspCorto').value; else delete borrador.nombre_corto;
    marcar();
  });
  $('aspLogoQuitar').addEventListener('click', () => { delete borrador.logo; delete borrador.cabecera; pintar(); marcar(); });
  $('aspLogoArchivo').addEventListener('change', async (ev) => {
    const archivo = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if(!archivo) return;
    $('aspLogoVer').innerHTML = '<span>Subiendo…</span>';
    try {
      const imagen = await reducirLogo(archivo);
      borrador.logo = await datosPlataforma.subirLogo(b.id, imagen);
      if(!borrador.cabecera) borrador.cabecera = 'logo_y_nombre';
      toast('Logo subido. Guarda el aspecto para que salga en la carta.');
    } catch(e) { fallo(e); }
    pintar(); marcar();
  });
  $('aspDeshacer').addEventListener('click', () => { borrador = JSON.parse(JSON.stringify(guardado)); pintar(); marcar(); });
  $('aspGuardar').addEventListener('click', async () => {
    $('aspGuardar').disabled = true;
    try {
      const nuevo = await datosPlataforma.aspecto(b.id, borrador);
      b.ajustes = Object.assign({}, b.ajustes, { aspecto: nuevo });
      Object.keys(guardado).forEach((k) => delete guardado[k]);
      Object.assign(guardado, JSON.parse(JSON.stringify(nuevo)));
      borrador = JSON.parse(JSON.stringify(nuevo));
      pintar(); marcar();
      toast('Guardado. La carta del bar ya sale así.');
    } catch(e) { fallo(e); marcar(); }
  });

  salirSinGuardar = async () => {
    if(!cambios || location.hash === '#bar/' + b.id + '/aspecto') { if(!cambios) salirSinGuardar = null; return true; }
    const ok = await confirmar('¿Salir sin guardar?', 'Los cambios del aspecto se perderán.', 'Salir sin guardar', true);
    if(ok){ salirSinGuardar = null; return true; }
    history.replaceState(null, '', '#bar/' + b.id + '/aspecto');
    return false;
  };
  pintar(); marcar();
}

// Dirección del logo para verlo aquí (las rutas de esta web van desde la raíz).
function urlLogo(u){ return /^https:\/\//.test(u) ? u : '../' + u; }

// El logo se reduce en el móvil (máx. 600 px de lado) antes de subirlo:
// PNG para conservar la transparencia; si pesa demasiado, JPEG.
function reducirLogo(archivo){
  return new Promise((ok, mal) => {
    const lector = new FileReader();
    lector.onerror = () => mal(new ErrorDatos('LOGO_NO_VALIDO'));
    lector.onload = () => {
      const img = new Image();
      img.onerror = () => mal(new ErrorDatos('LOGO_NO_VALIDO'));
      img.onload = () => {
        const f = Math.min(1, 600 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * f)); c.height = Math.max(1, Math.round(img.height * f));
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0, c.width, c.height);
        let d = c.toDataURL('image/png');
        if(d.length > 1300000){
          const c2 = document.createElement('canvas'); c2.width = c.width; c2.height = c.height;
          const x2 = c2.getContext('2d'); x2.fillStyle = '#FFFFFF'; x2.fillRect(0, 0, c2.width, c2.height); x2.drawImage(c, 0, 0);
          d = c2.toDataURL('image/jpeg', 0.88);
        }
        ok(d);
      };
      img.src = lector.result;
    };
    lector.readAsDataURL(archivo);
  });
}

/* ---------- Datos del bar y aviso legal (v29) ---------- */
async function verDatos(id){
  mostrar('vDatos');
  const cont = $('datContenido');
  cargando(cont);
  let b;
  try { b = await ficha(id); }
  catch(e) { fallo(e); cont.innerHTML = '<p class="vacio">No se ha podido abrir este bar.</p>'; return; }
  const a = b.ajustes || {}, l = a.legal || {};
  const pie = Array.isArray(a.pie) ? a.pie.join('\n') : '';
  cont.innerHTML = `
    <a class="volver" href="#bar/${b.id}">← ${esc(b.nombre)}</a>
    <div><p class="eti">Datos</p><h1>${esc(b.nombre)}</h1></div>
    <form id="fDatos" class="form" novalidate>
      <div class="seccion"><h2>El bar</h2><div class="caja form">
        <label class="campo"><span>Nombre del bar</span><input id="dNombre" maxlength="60" required value="${esc(b.nombre)}"><small>Sale en la carta, el panel, el tique y los títulos.</small></label>
        <label class="campo"><span>Subtítulo <i>(opcional)</i></span><input id="dSubtitulo" maxlength="80" value="${esc(b.subtitulo || '')}" placeholder="Cervecería · Desde 2007"></label>
        <label class="campo"><span>Pie de la carta <i>(una línea por renglón)</i></span><textarea id="dPie" rows="4" placeholder="IVA incluido">${esc(pie)}</textarea><small>Hasta 8 líneas. Vacío = solo el nombre del bar.</small></label>
      </div></div>
      <div class="seccion"><h2>Aviso legal y privacidad</h2>
        <p class="nota">Con titular, la carta enseña el enlace «Aviso legal y privacidad». Son los datos de quien explota el bar.</p>
        <div class="caja form">
          <label class="campo"><span>Titular <i>(nombre o razón social)</i></span><input id="dTitular" maxlength="200" value="${esc(l.titular || '')}"></label>
          <label class="campo"><span>NIF / CIF</span><input id="dNif" maxlength="200" autocapitalize="characters" value="${esc(l.nif || '')}"></label>
          <label class="campo"><span>Domicilio fiscal</span><input id="dDomicilio" maxlength="200" value="${esc(l.domicilio || '')}"></label>
          <label class="campo"><span>Correo de contacto</span><input id="dEmail" type="email" inputmode="email" autocapitalize="off" maxlength="200" value="${esc(l.email || '')}"></label>
          <label class="campo"><span>Teléfono <i>(opcional)</i></span><input id="dTelefono" type="tel" maxlength="200" value="${esc(l.telefono || '')}"></label>
          <label class="campo"><span>Datos registrales <i>(solo sociedades)</i></span><input id="dRegistro" maxlength="200" value="${esc(l.registro || '')}"></label>
        </div>
      </div>
      <p class="error" id="dError" role="alert" hidden></p>
      <button class="btn btn-azul" type="submit">Guardar datos</button>
    </form>`;
  $('fDatos').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('dError').hidden = true;
    const btn = $('fDatos').querySelector('button[type=submit]');
    const lineas = $('dPie').value.split('\n').map((x) => x.trim()).filter(Boolean);
    if(!$('dNombre').value.trim()){ verError($('dError'), 'FALTAN_DATOS'); return; }
    if(lineas.length > 8){ $('dError').textContent = 'El pie puede tener como mucho 8 líneas.'; $('dError').hidden = false; return; }
    btn.disabled = true;
    try {
      fichaActual = await datosPlataforma.datosBar(b.id, {
        nombre: $('dNombre').value.trim(), subtitulo: $('dSubtitulo').value.trim(), pie: lineas,
        legal: { titular: $('dTitular').value, nif: $('dNif').value, domicilio: $('dDomicilio').value,
                 email: $('dEmail').value, telefono: $('dTelefono').value, registro: $('dRegistro').value },
      });
      toast('Datos guardados');
      location.hash = '#bar/' + b.id;
    } catch(e) { if(e.codigo === 'SESION_CADUCADA') fallo(e); else verError($('dError'), e.codigo); }
    finally { btn.disabled = false; }
  });
}

/* ---------- Una persona del personal (v29) ---------- */
async function verPersona(id, uid){
  mostrar('vPersona');
  const cont = $('perContenido');
  cargando(cont);
  let b;
  try { b = await ficha(id); }
  catch(e) { fallo(e); cont.innerHTML = '<p class="vacio">No se ha podido abrir este bar.</p>'; return; }
  const u = uid ? (b.usuarios || []).find((x) => String(x.id) === String(uid)) : null;
  if(uid && !u){ cont.innerHTML = `<a class="volver" href="#bar/${b.id}">← ${esc(b.nombre)}</a><p class="vacio">No se encuentra esa persona.</p>`; return; }
  const rol = u ? u.rol : 'camarero';
  cont.innerHTML = `
    <a class="volver" href="#bar/${b.id}">← ${esc(b.nombre)}</a>
    <div><p class="eti">${u ? 'Personal' : 'Añadir persona'}</p><h1>${u ? esc(u.nombre) : 'Nueva persona'}</h1></div>
    <form id="fPersona" class="caja form" novalidate>
      <label class="campo"><span>Nombre</span><input id="pNombre" maxlength="60" required value="${esc(u ? u.nombre : '')}"></label>
      ${u ? `<div class="campo"><span>Correo</span><p class="dato-fijo mono">${esc(u.email)}</p></div>`
          : `<label class="campo"><span>Correo</span><input id="pEmail" type="email" inputmode="email" autocapitalize="off" autocomplete="off" required><small>Con él entrará en el panel. Le llegará un correo para elegir su contraseña.</small></label>`}
      <label class="campo"><span>Rol</span><select id="pRol">
        <option value="camarero"${rol === 'camarero' ? ' selected' : ''}>Camarero · ve y sirve los pedidos</option>
        <option value="barra"${rol === 'barra' ? ' selected' : ''}>Barra · además precios, agotados y resumen</option>
        <option value="admin"${rol === 'admin' ? ' selected' : ''}>Administrador · todo el panel del bar</option></select></label>
      ${u ? `<div class="opcion opcion-suelta">
        <div class="op-texto"><b>Activo</b><span>Desactivado no puede entrar en el panel (se cierra su sesión).</span></div>
        <label class="interruptor"><input type="checkbox" id="pActivo"${u.activo ? ' checked' : ''} aria-label="Activo"><span></span></label></div>` : ''}
      <p class="error" id="pError" role="alert" hidden></p>
      <button class="btn btn-azul" type="submit">${u ? 'Guardar' : 'Dar de alta y mandar correo'}</button>
    </form>`;
  $('fPersona').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('pError').hidden = true;
    const btn = $('fPersona').querySelector('button[type=submit]');
    const datos = { nombre: $('pNombre').value.trim(), rol: $('pRol').value };
    if(u){ datos.id = u.id; datos.activo = $('pActivo').checked; }
    else datos.email = $('pEmail').value.trim();
    if(!datos.nombre || (!u && !datos.email)){ verError($('pError'), 'FALTAN_DATOS'); return; }
    if(!u && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.email)){ verError($('pError'), 'EMAIL_NO_VALIDO'); return; }
    btn.disabled = true;
    try {
      const r = await datosPlataforma.usuario(b.id, datos);
      if(r.nuevo){
        let correo = true;
        try { await datosPlataforma.bienvenida(r.email); } catch(e) { correo = false; }
        toast(correo ? 'Dada de alta. Le hemos mandado el correo de bienvenida.' : 'Dada de alta, pero el correo no ha salido: usa «Mandar enlace».', !correo);
      } else toast('Guardado');
      fichaActual = null;
      location.hash = '#bar/' + b.id;
    } catch(e) { if(e.codigo === 'SESION_CADUCADA') fallo(e); else verError($('pError'), e.codigo); }
    finally { btn.disabled = false; }
  });
}

/* ---------- Alta de un bar ---------- */
let slugTocado = false;

function hacerSlug(t){
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
}
function verSlug(){
  const s = $('aSlug').value;
  $('aSlugVer').textContent = s ? 'carta.autonomialab.es/carta/?bar=' + s : '';
}

async function verAlta(){
  mostrar('vAlta');
  $('aError').hidden = true;
  // Las cartas que se pueden copiar: las de los bares activos.
  if(!bares.length){ try { bares = await datosPlataforma.bares() || []; } catch(e) { if(fallo(e)) return; } }
  const antes = $('aCopia').value;
  $('aCopia').innerHTML = '<option value="">Empezar vacía</option>' +
    bares.filter((b) => b.activo).map((b) => `<option value="${esc(b.slug)}">Copiar la carta de ${esc(b.nombre)}</option>`).join('');
  $('aCopia').value = antes && bares.some((b) => b.activo && b.slug === antes) ? antes : '';
  verSlug();
}

$('aNombre').addEventListener('input', () => {
  if(!slugTocado){ $('aSlug').value = hacerSlug($('aNombre').value); verSlug(); }
});
$('aSlug').addEventListener('input', () => {
  slugTocado = $('aSlug').value !== '';
  const limpio = $('aSlug').value.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if(limpio !== $('aSlug').value) $('aSlug').value = limpio;
  verSlug();
});

$('fAlta').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  $('aError').hidden = true;
  const datos = {
    nombre: $('aNombre').value.trim(),
    slug: $('aSlug').value.trim(),
    mesas: Number($('aMesas').value),
    email: $('aEmail').value.trim(),
    dueno: $('aDueno').value.trim(),
  };
  if($('aCopia').value) datos.copiar_de = $('aCopia').value;
  if(!datos.nombre || !datos.slug || !datos.email){ verError($('aError'), 'FALTAN_DATOS'); return; }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.email)){ verError($('aError'), 'EMAIL_NO_VALIDO'); return; }
  if(!Number.isInteger(datos.mesas) || datos.mesas < 1 || datos.mesas > 200){ verError($('aError'), 'MESAS_NO_VALIDAS'); return; }
  const b = $('fAlta').querySelector('button[type=submit]');
  b.disabled = true;
  let r;
  try { r = await datosPlataforma.alta(datos); }
  catch(e) { if(e.codigo === 'SESION_CADUCADA') fallo(e); else verError($('aError'), e.codigo); b.disabled = false; return; }
  // El bar ya existe: ahora el correo de bienvenida al dueño.
  let correo = true;
  try { await datosPlataforma.bienvenida(r.email); } catch(e) { correo = false; }
  b.disabled = false;
  $('fAlta').reset();
  $('aMesas').value = 10;
  slugTocado = false;
  bares = [];
  verHecho(r, correo);
});

function verHecho(r, correo){
  // Se cambia la dirección (sin recargar) para que «+ Nuevo bar» vuelva a abrir el alta.
  history.replaceState(null, '', location.pathname + location.search + '#hecho');
  mostrar('vHecho');
  $('hNombre').textContent = r.nombre;
  const carta = '../carta/?bar=' + encodeURIComponent(r.slug);
  const panel = '../panel/?bar=' + encodeURIComponent(r.slug);
  $('hContenido').innerHTML = `
    <div class="hecho-lista">
      <p>Carta: <b class="mono">carta.autonomialab.es/carta/?bar=${esc(r.slug)}</b></p>
      <p><b>${r.mesas}</b> mesas creadas, cada una con su QR (en su panel → Mesas).</p>
      <p>${correo
        ? `Correo de bienvenida enviado a <b>${esc(r.email)}</b>: con él elige su contraseña (vale 3 días).`
        : `No se ha podido mandar el correo a <b>${esc(r.email)}</b>. Mándalo desde la ficha del bar → Personal → «Mandar enlace».`}</p>
      <p>Todas las opciones están apagadas: enciéndelas en la ficha.</p>
    </div>
    <div class="hecho-botones">
      <a class="btn btn-azul" href="#bar/${r.id}">Ver ficha</a>
      <a class="btn btn-borde" href="${carta}" target="_blank" rel="noopener">Abrir carta ↗</a>
      <a class="btn btn-borde" href="${panel}" target="_blank" rel="noopener">Abrir panel ↗</a>
    </div>`;
}

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

/* ---------- Arranque ---------- */
(async function(){
  if(datosPlataforma.sesion() && !location.hash.startsWith('#recuperar=')){
    try {
      const yo = await datosPlataforma.yo();
      if(yo && yo.email) $('eEmail').value = yo.email;
    } catch(e) {
      if(e.codigo === 'SESION_CADUCADA'){ mostrar('vEntrar'); return; }
    }
  }
  irA();
})();
