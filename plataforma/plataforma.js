/* =====================================================================
   MultiBar · Plataforma (v27): el panel de autonomIA Lab para administrar
   los bares. Lista de bares con sus números, ficha con las opciones,
   dar de baja o reactivar y alta de un bar nuevo.
   Todo pasa por las funciones plataforma_* de la base (comun/datos.js →
   datosPlataforma), que solo aceptan la sesión de la cuenta de plataforma.
   Navegación por la dirección (#):  vacío → bares · #bar/ID → ficha ·
   #nuevo → alta · #recuperar=CÓDIGO → elegir contraseña (enlace del correo).
   ===================================================================== */

const $ = (id) => document.getElementById(id);
const VISTAS = ['vEntrar', 'vOlvido', 'vNueva', 'vBares', 'vFicha', 'vAlta', 'vHecho'];

// Las opciones que se encienden por bar (todas apagadas al dar de alta).
const OPCIONES = [
  { k: 'barra_cocina', t: 'Barra y cocina', d: 'Cada pestaña va a barra o a cocina; el panel filtra y cada parte lleva su estado.' },
  { k: 'avisos_mesa', t: 'Llamar al camarero', d: 'Botón «Camarero» en la carta: llamar o pedir la cuenta desde la mesa.' },
  { k: 'cuentas_mesa', t: 'Cuentas de mesas', d: 'Vista en el panel con lo pedido por mesa y el botón «Cobrada».' },
  { k: 'control_mesas', t: 'Control de mesas', d: 'El QR solo deja pedir cuando el personal abre la mesa en el panel.' },
  { k: 'destacados', t: 'Recomendados', d: 'Etiquetas Plato del día, Recomendado y Nuevo, y pestaña «★ Recomendados».' },
  { k: 'horarios', t: 'Carta por horario', d: 'Cada pestaña puede tener sus días y horas (desayunos, menú del día…).' },
  { k: 'fotos', t: 'Fotos de los productos', d: 'El admin del bar sube fotos desde su panel y salen en la carta.' },
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
  const m = h.match(/^bar\/(\d+)$/);
  if(m) return verFicha(m[1]);
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
  const a = b.ajustes || {}, s = b.stats || {};
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
      <h2>Personal</h2>
      <p class="nota">«Mandar enlace» le manda un correo para elegir contraseña (a quien no ha entrado nunca, el de bienvenida).</p>
      <div class="personas">
        ${(b.usuarios || []).length ? b.usuarios.map((u) => `
        <div class="persona">
          <div class="p-texto"><b>${esc(u.nombre)} <span class="p-rol">${esc(ROLES[u.rol] || u.rol)}</span></b>
            <span>${esc(u.email)}</span>
            ${!u.activo ? '<span>Desactivado</span>' : u.pendiente ? '<span class="p-pend">Aún no ha elegido contraseña</span>' : ''}</div>
          ${u.activo ? `<button class="btn btn-borde" type="button" data-enlace="${esc(u.email)}" data-pendiente="${u.pendiente ? 1 : 0}">Mandar enlace</button>` : ''}
        </div>`).join('') : '<p class="vacio">Sin personal.</p>'}
      </div>
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
