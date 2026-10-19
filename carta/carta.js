/* ---------------- DATOS DE LA CARTA ---------------- */
let MENU = [];
const PRODUCTS_BY_ID = {}; // id (string) -> {n,d,p,pop,al}

/* La carta se lee de la base (precios y agotados al día). Si la base no
   responde en unos segundos, se usa la copia de reserva del bar
   (datos/bares/<bar>/menu.json): la carta se ve igual y la base vuelve a
   comprobarse cada minuto. Si la base dice que el bar no existe o está
   de baja, no se enseña la copia. */
let MENU_DE_BASE = false;
function conTiempo(promesa, ms){
  return Promise.race([promesa, new Promise((_, no) => setTimeout(() => no(new Error("TIEMPO")), ms))]);
}
const RESERVA = '../datos/bares/' + BAR + '/';
async function loadMenu(){
  let menu = null;
  try { menu = await conTiempo(datosCarta.menu(), 6000); }
  catch(e) { if(e.codigo === 'BAR_NO_VALIDO') throw e; menu = null; }
  if(Array.isArray(menu) && menu.length){
    MENU_DE_BASE = true;
  } else {
    const res = await fetch(RESERVA + 'menu.json', { cache: 'no-cache' });
    if(!res.ok) throw new Error('No se pudo leer el menú (código ' + res.status + ')');
    menu = await res.json();
  }
  MENU = menu;
  MENU.forEach(c => c.items.forEach(it => {
    it.p = Number(it.p);
    it.agotado = !!it.agotado;
    it.cat = c.id;
    it.fuera = c.abierta === false;   // carta por horario (v25): ahora no se sirve
    PRODUCTS_BY_ID[String(it.dbId)] = it;
  }));
}

/* ---------------- RECOMENDADOS Y HORARIOS (v25) ----------------
   Opciones del bar (ajustes.destacados / ajustes.horarios): la base solo
   manda la etiqueta de cada producto y el horario de cada pestaña si el bar
   las tiene encendidas; si no, la carta sale como siempre. */
const MARCAS = { del_dia: "Plato del día", recomendado: "Recomendado", nuevo: "Nuevo" };
const ORDEN_MARCAS = ["del_dia", "recomendado", "nuevo"];
function etiquetaMarca(it){
  return it.marca && MARCAS[it.marca] ? `<span class="li-marca marca-${esc(it.marca)}">${MARCAS[it.marca]}</span>` : "";
}
/* ---------------- CARTA MÁS FÁCIL (v30) ----------------
   Seis opciones del bar (ajustes), apagadas por defecto: otra_ronda,
   alergenos, mas_pedidos, carta_hora, bienvenida y raciones. Con ellas
   apagadas la carta sale como siempre (la base tampoco manda al / rac / top). */
function opcion(k){ return !!(BAR_INFO && BAR_INFO.ajustes && BAR_INFO.ajustes[k] === true); }
// Los 14 alérgenos de la normativa europea (código en la base → icono y nombre).
const ALERGENOS = {
  gluten: ["🌾", "Gluten"], crustaceos: ["🦐", "Crustáceos"], huevo: ["🥚", "Huevo"], pescado: ["🐟", "Pescado"],
  cacahuetes: ["🥜", "Cacahuetes"], soja: ["🌱", "Soja"], lacteos: ["🥛", "Lácteos"], frutos_cascara: ["🌰", "Frutos de cáscara"],
  apio: ["🥬", "Apio"], mostaza: ["🟡", "Mostaza"], sesamo: ["⚪", "Sésamo"], sulfitos: ["🍷", "Sulfitos"],
  altramuces: ["🌼", "Altramuces"], moluscos: ["🦪", "Moluscos"],
};
function alergenosDe(it){ return Array.isArray(it.al) ? it.al.filter(a => ALERGENOS[a]) : []; }
function iconosAlergenos(it){
  const al = alergenosDe(it);
  return al.length ? `<span class="li-al" aria-label="Alérgenos: ${al.map(a => ALERGENOS[a][1]).join(", ")}">${al.map(a => `<i title="${ALERGENOS[a][1]}">${ALERGENOS[a][0]}</i>`).join("")}</span>` : "";
}
// Alergias que ha marcado este móvil (se recuerdan): los platos que las llevan salen avisados.
let ALERGIAS = (function(){ try { const a = leerLocal("carta.alergias"); return Array.isArray(a) ? a.filter(x => ALERGENOS[x]) : []; } catch(e) { return []; } })();

// No se puede añadir: agotado o fuera de horario.
function bloqueado(it){ return !!(it && (it.agotado || it.fuera)); }
const DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
function lista(xs){ return xs.length > 1 ? xs.slice(0, -1).join(", ") + " y " + xs[xs.length - 1] : (xs[0] || ""); }
// «de 13:00 a 16:00 y de 20:00 a 23:30, de lunes a viernes»
function textoHorario(h){
  if(!h || !Array.isArray(h.tramos) || !h.tramos.length) return "";
  let t = lista(h.tramos.map(x => x.desde === x.hasta ? "todo el día" : "de " + x.desde + " a " + x.hasta));
  const d = (Array.isArray(h.dias) ? h.dias : []).map(Number).filter(n => n >= 1 && n <= 7).sort();
  if(d.length && d.length < 7){
    const seguidos = d.every((n, i) => i === 0 || n === d[i - 1] + 1);
    t += ", " + (seguidos && d.length > 2 ? "de " + DIAS[d[0] - 1] + " a " + DIAS[d[d.length - 1] - 1] : lista(d.map(n => DIAS[n - 1])));
  }
  return t;
}
const catInfo = {}; // id de pestaña -> { tab, aviso, horario, abierta }
function pintarHorario(id){
  const c = catInfo[id];
  if(!c || !c.aviso) return;
  const txt = textoHorario(c.horario);
  c.aviso.hidden = !txt;
  c.aviso.classList.toggle("cerrada", !c.abierta);
  c.aviso.innerHTML = c.abierta ? "Se sirve " + esc(txt) + "." : "<b>Ahora no se sirve.</b> Horario: " + esc(txt) + ".";
  c.tab.classList.toggle("fuera", !c.abierta);
  if(c.tile) c.tile.classList.toggle("fuera", !c.abierta);
}

/* ---------------- EL BAR: NOMBRE, SUBTÍTULO Y PIE ----------------
   Salen de la base (tabla "bares"): el nombre se escribe una sola vez y
   cambia en toda la carta. Para que la cabecera salga al momento, se
   recuerda en el móvil la última vez; si la base no responde, se usa la
   copia de reserva datos/bares/<bar>/bar.json. */
let BAR_INFO = null;
let CARTA_LISTA = false; // true cuando init() ha terminado de pintar la carta
const barNombreEl = document.getElementById("barNombre");
const barPieEl = document.getElementById("barPie");
// Vista previa desde el panel de plataforma (v29): la plataforma (misma web)
// abre la carta dentro de su página y le manda el aspecto que se está
// eligiendo; la carta lo pinta sin guardarlo. Solo se aceptan mensajes de
// esta misma web.
let PREVIA = null;
window.addEventListener("message", (ev) => {
  if(ev.origin !== location.origin || !ev.data || ev.data.tipo !== "mb-vista-previa") return;
  PREVIA = (ev.data.aspecto && typeof ev.data.aspecto === "object") ? ev.data.aspecto : {};
  if(BAR_INFO) pintarBar(BAR_INFO);
});
function pintarBar(info){
  if(!info || !info.nombre) return;
  BAR_INFO = info;
  if(PREVIA) info = Object.assign({}, info, { ajustes: Object.assign({}, info.ajustes, { aspecto: PREVIA }) });
  // Colores, fuentes, logo, icono para instalar y textos del bar (comun/aspecto.js).
  Aspecto.aplicar(info, { instalable: true });
  pintarTextos();
  pintarLlamar();
  pintarHerramientas();
  barNombreEl.textContent = String(info.nombre).toUpperCase();
  if(!document.body.classList.contains("modo-pedir") && !QR_INVALIDO) heroLine.textContent = info.subtitulo || "";
  const pie = (info.ajustes && Array.isArray(info.ajustes.pie)) ? info.ajustes.pie : [info.nombre];
  barPieEl.innerHTML = pie.map(l => "<div>" + esc(l) + "</div>").join("");
  // Enlace al aviso legal y privacidad: solo cuando el bar tiene sus datos de titular.
  const conLegal = !!(info.ajustes && info.ajustes.legal && info.ajustes.legal.titular);
  document.getElementById("legalEnlace").hidden = !conLegal;
  document.getElementById("legalLink").href = "../legal/?bar=" + encodeURIComponent(info.slug || BAR);
  document.title = info.nombre + " · Carta digital";
}
// Textos que cada bar puede cambiar (ajustes.aspecto.textos).
function pintarTextos(){
  document.getElementById("openCartBtn").textContent = Aspecto.texto("ver_tique");
  document.getElementById("txtTuTique").textContent = Aspecto.texto("tu_tique");
  document.getElementById("txtTotal").textContent = Aspecto.texto("total");
  document.getElementById("pieTique").textContent = document.body.classList.contains("modo-pedir") ? Aspecto.texto("pie_pedir") : Aspecto.texto("pie_mirar");
  if(CARTA_LISTA) updateCartBar();
}
async function loadBar(){
  // Lo recordado de la última vez (solo si ya trae el aspecto del bar: _v 2, carta v12).
  const recordado = leerLocal("bar." + BAR);
  if(recordado && recordado._v === 2) pintarBar(recordado);
  let info = null;
  try { info = await conTiempo(datosCarta.bar(), 6000); }
  catch(e) { if(e.codigo === 'BAR_NO_VALIDO'){ document.documentElement.classList.remove("mb-cargando"); return; } }
  if(!info){
    try { const r = await fetch(RESERVA + 'bar.json', { cache: 'no-cache' }); if(r.ok) info = await r.json(); } catch(e) { /* sin reserva */ }
  } else {
    guardarLocal("bar." + BAR, Object.assign({ _v: 2 }, info));
  }
  pintarBar(info);
  // Sin base ni copia de reserva: se enseña la carta igualmente (con lo que haya).
  if(!info) document.documentElement.classList.remove("mb-cargando");
}

/* ---------------- STATE ---------------- */
const cart = {};
const notes = {}; // key -> free-text note for the current (not-yet-sent) round
const rowRefs = {}; // key -> array of {addBtn, stepper, qEl, noteRow, noteInput}

function money(v){ return v.toFixed(2).replace(".",",") + "€"; }
// Texto que viene de la base o del cliente: siempre escapado antes de pintarlo.
function esc(t){ return String(t == null ? "" : t).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
const MAX_UDS = 20; // unidades máximas por producto en un pedido (lo exige la base)

/* ---------------- LINE BUILDER ---------------- */
function buildLine(it){
  const key = String(it.dbId);
  const row = document.createElement("div");
  row.className = "line-item";
  row.dataset.name = it.n.toLowerCase();
  row.dataset.key = key;
  if(alergenosDe(it).length) row.dataset.al = alergenosDe(it).join(" ");
  row.innerHTML = `
    ${it.img && !it.lab ? `<button type="button" class="li-foto" aria-label="Ver foto: ${esc(it.dn || it.n)}"><img src="${esc(it.img)}" alt="" loading="lazy" decoding="async"></button>` : ""}
    <div class="li-main">
      <div class="li-name-row">
        ${it.pop ? '<span class="li-star">★</span>' : ""}
        ${etiquetaMarca(it)}
        ${it.lab ? `<span class="li-sublab">${esc(it.lab)}</span>` : `<span class="li-name">${esc(it.dn || it.n)}</span>`}
        ${it.lab ? "" : (it.d ? `<span class="li-sub">${esc(it.d)}</span>` : "")}
        ${iconosAlergenos(it)}
      </div>
      <div class="li-pricerow"><span class="li-price">${money(it.p)}</span></div>
      ${it.rac ? `<div class="li-racion">${esc(it.rac)}</div>` : ""}
      <div class="li-alergia" hidden></div>
    </div>
    <span class="li-connector"></span>
    <span class="li-ctrl"></span>
  `;

  const fb = row.querySelector(".li-foto");
  if(fb) fb.addEventListener("click", () => abrirFicha([PRODUCTS_BY_ID[String(it.dbId)] || it]));

  const noteRow = document.createElement("div");
  noteRow.className = "note-row";
  noteRow.style.display = "none";
  noteRow.innerHTML = `<input type="text" class="note-input" placeholder="nota (opcional)" maxlength="140">`;
  const noteInput = noteRow.querySelector(".note-input");
  noteInput.addEventListener("input", () => { notes[key] = noteInput.value; });

  buildControl(key, row.querySelector(".li-ctrl"), noteRow, noteInput);
  const ref = rowRefs[key][rowRefs[key].length - 1];
  ref.row = row;
  ref.priceEl = row.querySelector(".li-price");

  const wrap = document.createElement("div");
  wrap.appendChild(row);
  wrap.appendChild(noteRow);
  wrap.className = "li-wrap"; if(it.size) wrap.dataset.size = it.size; if(it.only) wrap.dataset.only = "1";
  return wrap;
}

function buildControl(key, mount, noteRow, noteInput){
  const addBtn = document.createElement("button");
  addBtn.className = "bracket-add";
  addBtn.textContent = "+";
  addBtn.addEventListener("click", () => {
    if(bloqueado(PRODUCTS_BY_ID[key])) return;
    cart[key] = (cart[key]||0) + 1;
    renderControls(key);
  });
  const stepper = document.createElement("div");
  stepper.className = "bracket-stepper";
  stepper.innerHTML = `<span class="q">0</span><div class="btn-pair"><button class="minus">−</button><button class="plus">+</button></div>`;
  stepper.querySelector(".minus").addEventListener("click", () => {
    cart[key] = Math.max(0, (cart[key]||0) - 1);
    if(cart[key] === 0) delete cart[key];
    renderControls(key);
  });
  const plusBtn = stepper.querySelector(".plus");
  plusBtn.addEventListener("click", () => {
    if(bloqueado(PRODUCTS_BY_ID[key]) || (cart[key]||0) >= MAX_UDS) return;
    cart[key] = (cart[key]||0) + 1;
    renderControls(key);
  });
  const agEl = document.createElement("span");
  agEl.className = "li-agotado";
  agEl.textContent = "Agotado";
  mount.appendChild(addBtn);
  mount.appendChild(stepper);
  mount.appendChild(agEl);
  (rowRefs[key] ||= []).push({ addBtn, stepper, plusBtn, agEl, qEl: stepper.querySelector(".q"), noteRow, noteInput });
}

function renderControls(key){
  pintarControles(key);
  updateCartBar();
}

// Pinta el + / − / "Agotado" y el precio de un producto (sin recalcular el tique).
function pintarControles(key){
  const qty = cart[key] || 0;
  const agotado = bloqueado(PRODUCTS_BY_ID[key]);
  (rowRefs[key] || []).forEach(r => {
    if(r.row) r.row.classList.toggle("agotado", agotado);
    r.agEl.textContent = PRODUCTS_BY_ID[key].agotado ? "Agotado" : "Fuera de horario";
    if(r.priceEl) r.priceEl.textContent = money(PRODUCTS_BY_ID[key].p);
    r.agEl.style.display = (agotado && qty === 0) ? "inline-block" : "none";
    if(qty > 0){
      r.addBtn.style.display = "none";
      r.stepper.style.display = "inline-flex";
      r.qEl.textContent = qty;
      r.plusBtn.disabled = agotado || qty >= MAX_UDS;
      r.noteRow.style.display = "block";
    } else {
      r.addBtn.style.display = agotado ? "none" : "inline-block";
      r.stepper.style.display = "none";
      r.noteRow.style.display = "none";
      r.noteInput.value = "";
    }
  });
}

/* ---------------- RENDER MENU (single horizontal tab strip, "Lo de siempre" first) ---------------- */
const menuEl = document.getElementById("menu");
const catTabs = document.getElementById("catTabs");
const catTabButtons = [];
const catPanels = [];

function addCategory(id, name, buildItems, sec){
  const tab = document.createElement("button");
  tab.className = "cat-tab" + (id === "_recomendados" || id === "_lomejor" ? " tab-recomendados" : "");
  tab.innerHTML = `<span class="tab-label">${esc(name)}</span><span class="tab-badge"></span>`;
  catTabs.appendChild(tab);
  catTabButtons.push(tab);

  const panel = document.createElement("div");
  panel.className = "cat-panel";
  panel.id = "panel-" + id;
  const head = document.createElement("div");
  head.className = "cat-head";
  const nice = name.charAt(0) + name.slice(1).toLowerCase();
  head.innerHTML = `<h2>${esc(nice)}</h2><span class="cat-right"><span class="cat-count"></span><button type="button" class="al-info" aria-label="Alérgenos">i</button></span>`;
  panel.appendChild(head);
  const note = document.createElement("div");
  note.className = "al-note";
  note.innerHTML = "<b>Alérgenos:</b> [G] Gluten · [L] Lácteos · [H] Huevo · [F] Frutos secos · [Su] Sulfitos";
  panel.appendChild(note);
  head.querySelector(".al-info").addEventListener("click", () => note.classList.toggle("open"));
  // Alérgenos (v30): franja para marcar las alergias de quien pide.
  if(opcion("alergenos")){
    const fa = document.createElement("button");
    fa.type = "button"; fa.className = "alergia-franja";
    fa.addEventListener("click", abrirAlergias);
    panel.appendChild(fa);
  }
  // Carta por horario (v25): cuándo se sirve esta pestaña.
  const avisoHorario = document.createElement("div");
  avisoHorario.className = "horario-aviso";
  avisoHorario.hidden = true;
  panel.appendChild(avisoHorario);
  if(sec){ catInfo[id] = { tab, aviso: avisoHorario, horario: sec.horario || null, abierta: sec.abierta !== false }; }
  buildItems(panel);
  if(sec) pintarHorario(id);
  const n = panel.querySelectorAll(".line-item").length;
  head.querySelector(".cat-count").textContent = n === 1 ? "1 producto" : n + " productos";
  panel.dataset.n = n;
  if(!panel.querySelector(".li-allergens")) head.style.display = "none";
  menuEl.appendChild(panel);
  catPanels.push(panel);

  tab.addEventListener("click", () => mostrarPanel(tab, panel));
}
function mostrarPanel(tab, panel){
  if(BUSCANDO) cerrarBuscador();
  catTabs.querySelectorAll(".cat-tab").forEach(t => t.classList.remove("active"));
  menuEl.querySelectorAll(".cat-panel").forEach(p => p.classList.remove("active"));
  tab.classList.add("active");
  panel.classList.add("active");
  // Cada pestaña empieza en su primer producto (si estabas más abajo, se sube al principio).
  if(window.scrollY > 0) window.scrollTo(0, 0);
  tab.scrollIntoView({behavior:"smooth", block:"nearest", inline:"center"});
}

function renderCategories(){
  // Recomendados (v25): los productos con etiqueta, en su propia pestaña delante.
  const marcados = [];
  MENU.forEach(sec => sec.items.forEach(it => { if(it.marca && MARCAS[it.marca]) marcados.push(it); }));
  // Lo mejor (v30, opción mas_pedidos): lo más pedido en el bar y los
  // recomendados, juntos en la primera pestaña. Solo con 3 o más productos.
  const masPedidos = [];
  if(opcion("mas_pedidos")) MENU.forEach(sec => sec.items.forEach(it => { if(it.top) masPedidos.push(it); }));
  masPedidos.sort((a, b) => a.top - b.top);
  const conPortada = masPedidos.length >= 3;
  if(marcados.length) marcados.sort((a, b) => ORDEN_MARCAS.indexOf(a.marca) - ORDEN_MARCAS.indexOf(b.marca));
  if(conPortada){
    addCategory("_lomejor", "LO MEJOR", (wrap) => {
      const cap = (t) => { const c = document.createElement("div"); c.className = "sec-cap"; c.textContent = t; wrap.appendChild(c); };
      cap("Lo más pedido");
      masPedidos.forEach(it => wrap.appendChild(buildLine(Object.assign({}, it, { dn: it.n }))));
      if(marcados.length){
        cap("Recomendados");
        marcados.forEach(it => wrap.appendChild(buildLine(Object.assign({}, it, { dn: it.n }))));
      }
    });
  } else if(marcados.length){
    addCategory("_recomendados", "RECOMENDADOS", (wrap) => {
      marcados.forEach(it => wrap.appendChild(buildLine(Object.assign({}, it, { dn: it.n }))));
    });
  }
  // Carta según la hora (v30, opción carta_hora): primero lo que se sirve ahora.
  const secciones = opcion("carta_hora") ? MENU.filter(c => c.abierta !== false).concat(MENU.filter(c => c.abierta === false)) : MENU;
  secciones.forEach(sec => {
    addCategory(sec.id, sec.name, (wrap) => pintarProductos(wrap, sec.items, sec.multi), sec);
  });

  if(opcion("pestanas_cuadricula") && catPanels.length > 1) crearCuadricula();
  else {
    catTabButtons[0].classList.add("active");
    catPanels[0].classList.add("active");
  }
  pintarAlergias();
}

/* ---------------- PESTAÑAS EN CUADRÍCULA (v31, opción pestanas_cuadricula) ----------------
   Al abrir la carta, todas las pestañas en botones grandes (de dos en dos):
   se ve de un vistazo todo lo que hay. Al tocar una se abre esa pestaña; el
   botón ▦ del principio de la tira vuelve a la cuadrícula. */
const catTiles = [];
const ICONO_CUADRICULA = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.6" fill="currentColor"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6" fill="currentColor"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6" fill="currentColor"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6" fill="currentColor"/></svg>';
function crearCuadricula(){
  const tab = document.createElement("button");
  tab.type = "button";
  tab.className = "cat-tab tab-cuadricula";
  tab.setAttribute("aria-label", "Ver todas las pestañas");
  tab.innerHTML = ICONO_CUADRICULA;
  catTabs.insertBefore(tab, catTabs.firstChild);

  const panel = document.createElement("div");
  panel.className = "cat-panel cuadricula";
  panel.id = "panel-_cuadricula";
  panel.innerHTML = `<div class="cq-titulo">¿Qué te apetece?</div><div class="cq-grid"></div>`;
  const grid = panel.querySelector(".cq-grid");
  catPanels.forEach((p, idx) => {
    const t = catTabButtons[idx];
    const nombre = t.querySelector(".tab-label").textContent;
    const n = Number(p.dataset.n) || 0;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cq-tile" + (t.classList.contains("tab-recomendados") ? " cq-destacada" : "") + (t.classList.contains("fuera") ? " fuera" : "");
    b.innerHTML = `<span class="cq-nombre">${esc(nombre.charAt(0) + nombre.slice(1).toLowerCase())}</span>`
      + `<span class="cq-n">${n === 1 ? "1 producto" : n + " productos"}</span><span class="tab-badge"></span>`;
    b.addEventListener("click", () => mostrarPanel(t, p));
    grid.appendChild(b);
    catTiles[idx] = b;
    const id = p.id.replace(/^panel-/, "");
    if(catInfo[id] && catInfo[id].tab === t) catInfo[id].tile = b;
  });
  menuEl.insertBefore(panel, menuEl.firstChild);
  tab.addEventListener("click", () => mostrarPanel(tab, panel));
  tab.classList.add("active");
  panel.classList.add("active");
}

/* ---------------- BUSCADOR (v31, opción buscador) ----------------
   La lupa de arriba abre un recuadro para escribir: busca en toda la carta
   mientras se escribe (sin importar tildes ni mayúsculas) y cada resultado
   lleva su + / − para añadirlo al momento. */
const buscadorEl = document.getElementById("buscador");
const buscarInput = document.getElementById("buscarInput");
const resultadosEl = document.createElement("div");
resultadosEl.id = "resultados";
let BUSCANDO = false;
let buscarTimer;
function normalizar(t){ return String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function abrirBuscador(){
  buscadorEl.hidden = false;
  buscarInput.focus();
}
function cerrarBuscador(){
  clearTimeout(buscarTimer);
  buscarInput.value = "";
  buscadorEl.hidden = true;
  buscar("");
}
// Quita los + / − de los resultados anteriores (para no dejar referencias sueltas).
function limpiarResultados(){
  Object.keys(rowRefs).forEach(k => { rowRefs[k] = rowRefs[k].filter(r => !r.busqueda); });
  resultadosEl.innerHTML = "";
}
function buscar(texto){
  const palabras = normalizar(texto).split(/\s+/).filter(Boolean);
  limpiarResultados();
  const antes = BUSCANDO;
  BUSCANDO = palabras.join("").length >= 2;
  document.body.classList.toggle("buscando", BUSCANDO);
  if(!BUSCANDO){ if(antes) window.scrollTo(0, 0); return; }
  if(!resultadosEl.parentNode) menuEl.appendChild(resultadosEl);
  const MAX = 40;
  let total = 0, pintados = 0;
  MENU.forEach(sec => {
    const hallados = sec.items.filter(it => {
      const donde = normalizar(it.n + " " + (it.dn || "") + " " + (it.d || ""));
      return palabras.every(p => donde.includes(p));
    });
    total += hallados.length;
    const caben = hallados.slice(0, Math.max(0, MAX - pintados));
    if(!caben.length) return;
    const cap = document.createElement("div");
    cap.className = "sec-cap";
    cap.textContent = sec.name.charAt(0) + sec.name.slice(1).toLowerCase();
    resultadosEl.appendChild(cap);
    pintarProductos(resultadosEl, caben, false);
    pintados += caben.length;
  });
  Object.keys(rowRefs).forEach(k => rowRefs[k].forEach(r => {
    if(!r.busqueda && r.row && resultadosEl.contains(r.row)){ r.busqueda = true; pintarControles(k); }
  }));
  if(!total){
    resultadosEl.innerHTML = `<div class="bus-nada">No hay nada con «${esc(texto.trim())}».<br>Prueba con otra palabra.</div>`;
  } else if(total > pintados){
    const m = document.createElement("div");
    m.className = "bus-nada";
    m.textContent = "Y " + (total - pintados) + " más: escribe alguna letra más para afinar.";
    resultadosEl.appendChild(m);
  }
  pintarAlergias();
  if(!antes || window.scrollY > 0) window.scrollTo(0, 0);
}
buscarInput.addEventListener("input", () => {
  clearTimeout(buscarTimer);
  buscarTimer = setTimeout(() => buscar(buscarInput.value), 150);
});
buscarInput.addEventListener("keydown", ev => {
  if(ev.key === "Enter"){ ev.preventDefault(); buscarInput.blur(); }
  if(ev.key === "Escape") cerrarBuscador();
});
document.getElementById("buscarBtn").addEventListener("click", () => { if(buscadorEl.hidden) abrirBuscador(); else cerrarBuscador(); });
document.getElementById("buscarCerrar").addEventListener("click", cerrarBuscador);

/* ---------------- LETRA GRANDE (v31, opción letra_grande) ----------------
   El botón «A+» de arriba agranda la carta y el tique. Cada móvil lo recuerda. */
const letraBtn = document.getElementById("letraBtn");
let LETRA_GRANDE = (function(){ try { return leerLocal("carta.letra") === 1; } catch(e) { return false; } })();
function pintarHerramientas(){
  const conLetra = opcion("letra_grande"), conBuscar = opcion("buscador");
  letraBtn.hidden = !conLetra;
  document.getElementById("buscarBtn").hidden = !conBuscar;
  document.querySelector(".ticket-head").classList.toggle("con-herr", conLetra || conBuscar);
  document.body.classList.toggle("letra-grande", conLetra && LETRA_GRANDE);
  letraBtn.setAttribute("aria-pressed", conLetra && LETRA_GRANDE ? "true" : "false");
  if(!conBuscar && !buscadorEl.hidden) cerrarBuscador();
}
letraBtn.addEventListener("click", () => {
  LETRA_GRANDE = !LETRA_GRANDE;
  try { guardarLocal("carta.letra", LETRA_GRANDE ? 1 : 0); } catch(e) {}
  pintarHerramientas();
});

// Pinta una lista de productos: los tamaños del mismo plato (Tapa / Plato…)
// juntos bajo su nombre y, si la pestaña junta varias secciones, sus subtítulos.
function pintarProductos(wrap, its, multi){
  let last = null;
  for(let i = 0; i < its.length; ){
    const it = its[i];
    if(multi && it.sec !== last){ last = it.sec; const cp = document.createElement("div"); cp.className = "sec-cap"; cp.textContent = it.sec.charAt(0) + it.sec.slice(1).toLowerCase(); wrap.appendChild(cp); }
    let j = i + 1;
    if(it.size && !it.only){ while(j < its.length && its[j].dn === it.dn && its[j].size && !its[j].only) j++; }
    if(j - i > 1){
      const grp = its.slice(i, j);
      const common = grp.every(x => x.d === grp[0].d);
      const g = document.createElement("div"); g.className = "vgroup";
      const h = document.createElement("div"); h.className = "vhead";
      h.innerHTML = '<span class="li-name">' + esc(it.dn) + '</span>' + (common && it.d ? '<span class="li-sub">' + esc(it.d) + '</span>' : "");
      // Fotos (v26): la miniatura del grupo (Tapa / Plato…) va en su cabecera.
      const conFoto = grp.find(x => x.img);
      if(conFoto){
        h.classList.add("con-foto");
        const fb = document.createElement("button");
        fb.type = "button"; fb.className = "li-foto"; fb.setAttribute("aria-label", "Ver foto: " + it.dn);
        fb.innerHTML = `<img src="${esc(conFoto.img)}" alt="" loading="lazy" decoding="async">`;
        fb.addEventListener("click", () => abrirFicha(grp.map(x => PRODUCTS_BY_ID[String(x.dbId)] || x)));
        h.insertBefore(fb, h.firstChild);
      }
      g.appendChild(h);
      grp.forEach(x => { const o = Object.assign({}, x, {lab: x.size + (!common && x.d ? " · " + x.d : "")}); const w = buildLine(o); g.appendChild(w); });
      wrap.appendChild(g);
    } else {
      wrap.appendChild(buildLine(it));
    }
    i = j;
  }
}

/* ---------------- ALERGIAS (v30, opción alergenos) ----------------
   Quien pide marca sus alergias y los platos que las llevan salen avisados
   en rojo (no se esconden). Solo se marca lo que ha indicado el bar. */
function pintarAlergias(){
  if(!opcion("alergenos")) return;
  const nombres = ALERGIAS.map(a => ALERGENOS[a][1].toLowerCase());
  document.querySelectorAll(".alergia-franja").forEach(b => {
    b.classList.toggle("activa", ALERGIAS.length > 0);
    b.innerHTML = ALERGIAS.length
      ? `<b>Tus alergias: ${esc(lista(nombres))}</b><span>Cambiar</span>`
      : `<b>¿Alergias?</b><span>Márcalas y te avisamos en cada plato</span>`;
  });
  document.querySelectorAll(".line-item").forEach(row => {
    const al = (row.dataset.al || "").split(" ").filter(Boolean);
    const lleva = al.filter(a => ALERGIAS.includes(a));
    row.classList.toggle("con-alergia", lleva.length > 0);
    const av = row.querySelector(".li-alergia");
    if(av){ av.hidden = !lleva.length; av.textContent = lleva.length ? "Contiene " + lista(lleva.map(a => ALERGENOS[a][1].toLowerCase())) : ""; }
  });
}
const alergiasEl = document.createElement("div");
alergiasEl.className = "ficha-foto alergias";
alergiasEl.hidden = true;
alergiasEl.setAttribute("role", "dialog");
alergiasEl.setAttribute("aria-modal", "true");
document.body.appendChild(alergiasEl);
function abrirAlergias(){
  alergiasEl.innerHTML = `<div class="ff-caja al-caja">
      <button type="button" class="ff-cerrar" aria-label="Cerrar">✕</button>
      <div class="ff-texto">
        <div class="ff-nombre">¿A qué tienes alergia?</div>
        <div class="ff-desc">Marca lo que no puedes tomar y te avisamos en cada plato que lo lleve.</div>
        <div class="al-lista">${Object.keys(ALERGENOS).map(a => `<button type="button" class="al-op${ALERGIAS.includes(a) ? " sel" : ""}" data-al="${a}"><i>${ALERGENOS[a][0]}</i>${ALERGENOS[a][1]}</button>`).join("")}</div>
        <p class="al-aviso">Información del bar. Si tu alergia es grave, díselo también al camarero.</p>
        <button type="button" class="ff-anadir al-listo">Listo</button>
      </div>
    </div>`;
  alergiasEl.hidden = false;
}
alergiasEl.addEventListener("click", ev => {
  const op = ev.target.closest(".al-op");
  if(op){ op.classList.toggle("sel"); return; }
  if(ev.target === alergiasEl || ev.target.closest(".ff-cerrar") || ev.target.closest(".al-listo")){
    ALERGIAS = Array.from(alergiasEl.querySelectorAll(".al-op.sel")).map(b => b.dataset.al);
    try { guardarLocal("carta.alergias", ALERGIAS); } catch(e) {}
    alergiasEl.hidden = true; alergiasEl.innerHTML = "";
    pintarAlergias();
  }
});

/* ---------------- CART SUMMARY ---------------- */
function cartLines(){
  const lines = [];
  Object.keys(cart).forEach(key => {
    const it = PRODUCTS_BY_ID[key];
    lines.push({ key, name: it.n, qty: cart[key], price: it.p, note: notes[key] || "" });
  });
  return lines;
}
function cartTotal(lines){ return lines.reduce((sum,l) => sum + l.qty*l.price, 0); }
function cartCount(lines){ return lines.reduce((sum,l) => sum + l.qty, 0); }

/* ---------------- PEDIDOS YA ENVIADOS DESDE ESTE MÓVIL ----------------
   Los da la base (mis_pedidos). El cliente puede cambiar o anular un
   pedido solo mientras está NUEVO: 3 minutos y antes de que la barra
   pulse "Aceptar pedido". La base lo vuelve a comprobar siempre. */
const rounds = []; // {num, orderId, status, editableHasta, lines:[{itemId,key,name,price,qty,note}], total}

function aRonda(p, ahora){
  return {
    num: p.ronda,
    orderId: p.id,
    destino: p.destino || null,   // 'barra' | 'cocina' si el bar los separa (v15)
    status: p.estado,
    editableHasta: (ahora || Date.now()) + (Number(p.editable_seg) || 0) * 1000,
    lines: (p.lineas || []).map(l => ({
      itemId: l.id, key: String(l.producto), name: l.nombre,
      price: Number(l.precio), qty: Number(l.cantidad), note: l.nota || "",
    })),
    total: Number(p.total) || 0,
  };
}
function roundEditable(r){ return r.status === 'enviado' && Date.now() < r.editableHasta - 1000; }
function roundLocked(r){ return !roundEditable(r); }
function roundLabel(r){
  if(r.status === 'servido') return "SERVIDO ✓";
  if(r.status === 'en_preparacion') return "EN PREPARACIÓN";
  return "ENVIADO";
}
function cuentaAtras(r){
  const s = Math.max(0, Math.floor((r.editableHasta - Date.now()) / 1000));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

let firmaRondas = "";
// Pide a la base los pedidos de este móvil en esta mesa. Devuelve true si algo cambió.
async function refreshRoundStatuses(){
  if(!MESA) return false;
  let lista;
  try { lista = await datosCarta.misPedidos(); } catch(e) { return false; } // sin cobertura: se queda lo que había
  const ahora = Date.now();
  const mias = (lista || []).filter(p => p.mesa === MESA.id);
  rounds.splice(0, rounds.length, ...mias.map(p => aRonda(p, ahora)));
  const firma = JSON.stringify(mias.map(p => [p.id, p.estado, p.total, p.lineas]));
  const cambio = firma !== firmaRondas;
  firmaRondas = firma;
  return cambio;
}

const MSG_YA_EN_MARCHA = "La barra ya está preparando este pedido y no se puede cambiar. Si quieres algo más, haz un pedido nuevo.";
let editando = false;
async function adjustSentItem(round, line, delta){
  if(editando) return;
  const nueva = line.qty + delta;
  if(nueva < 0 || nueva > MAX_UDS) return;
  if(!roundEditable(round)){ updateCartBar(); aviso("YA EN MARCHA", MSG_YA_EN_MARCHA); return; }
  const lineas = round.lines
    .map(l => ({ producto: Number(l.key), cantidad: l === line ? nueva : l.qty, nota: l.note || "" }))
    .filter(l => l.cantidad > 0);
  const otrasPartes = rounds.some(r => r.num === round.num && r.orderId !== round.orderId);
  if(lineas.length === 0 && !otrasPartes && !window.confirm("¿Anular el pedido " + round.num + "? Se borra y no llega a la barra.")) return;
  editando = true;
  panelBody.classList.add("ocupado");
  try {
    const r = await datosCarta.editarPedido(round.orderId, lineas);
    const i = rounds.findIndex(x => x.orderId === round.orderId);
    if(r && r.anulado){ if(i >= 0) rounds.splice(i, 1); }
    else if(r && i >= 0){ rounds[i] = aRonda(r); }
  } catch(err) {
    if(err.codigo === 'YA_NO_EDITABLE'){ await refreshRoundStatuses(); aviso("YA EN MARCHA", MSG_YA_EN_MARCHA); }
    else {
      if(err.codigo === 'AGOTADO'){ ultimaCarta = 0; refrescarCarta(); }
      aviso("NO SE HA CAMBIADO", err.message);
    }
  } finally {
    editando = false;
    panelBody.classList.remove("ocupado");
    updateCartBar();
    refrescarMesaPedida().then(c => { if(c) updateCartBar(); });
  }
}

const cartCountLbl = document.getElementById("cartCountLbl");
const cartTotalLbl = document.getElementById("cartTotalLbl");
const bottomSendBtn = document.getElementById("bottomSendBtn");
const sendBtn = document.getElementById("sendBtn");
let enviando = false;

/* Otra ronda (v30, opción otra_ronda): repetir el último pedido de este
   móvil con un toque. Se añade al tique (no se envía solo) para que se pueda
   cambiar; lo agotado o fuera de horario no se añade. */
function ultimoPedido(){
  if(!MESA || !opcion("otra_ronda")) return null;
  const pedidos = pedidosDelTique(rounds);
  const g = pedidos[pedidos.length - 1];
  if(!g) return null;
  const lineas = [];
  g.partes.forEach(r => r.lines.forEach(l => {
    if(l.qty <= 0 || !PRODUCTS_BY_ID[l.key]) return;
    const x = lineas.find(y => y.key === l.key);
    if(x) x.qty += l.qty; else lineas.push({ key: l.key, qty: l.qty, name: PRODUCTS_BY_ID[l.key].n });
  }));
  return lineas.length ? { num: g.num, lineas } : null;
}
function resumenPedido(u){
  const t = u.lineas.map(l => l.qty + " × " + l.name).join(", ");
  return t.length > 42 ? t.slice(0, 40).replace(/[ ,×]+$/, "") + "…" : t;
}
function repetirPedido(){
  const u = ultimoPedido();
  if(!u) return;
  const fuera = [];
  u.lineas.forEach(l => {
    if(bloqueado(PRODUCTS_BY_ID[l.key])){ fuera.push(l.name); return; }
    cart[l.key] = Math.min(MAX_UDS, (cart[l.key] || 0) + l.qty);
    pintarControles(l.key);
  });
  updateCartBar();
  if(!panel.classList.contains("show")) openPanel();
  if(fuera.length) aviso("NO DISPONIBLE", "Ahora no hay: " + fuera.join(", ") + ". El resto está en tu pedido, listo para enviar.");
}

function updateCartBar(){
  const lines = cartLines();
  const count = cartCount(lines);
  const currentTotal = cartTotal(lines);
  const grandTotal = rounds.reduce((s,r) => s + r.total, 0) + currentTotal;
  cartCountLbl.textContent = count === 1 ? "1 línea" : count + " líneas";
  cartTotalLbl.textContent = money(currentTotal);
  renderPanel(lines, grandTotal);
  // Sin productos: de la barra de enviar solo queda una línea fina encima de la barra azul
  // Otra ronda (v30): sin nada escogido, la barra de enviar ofrece repetir el último pedido.
  const repetible = count === 0 && !enviando ? ultimoPedido() : null;
  bottomSendBtn.textContent = enviando ? "Enviando…" : (repetible ? "↻ Otra igual: " + resumenPedido(repetible) : (count === 0 ? "" : Aspecto.texto("enviar")));
  bottomSendBtn.classList.toggle("idle", count === 0 && !enviando && !repetible);
  bottomSendBtn.classList.toggle("repetir", !!repetible);
  bottomSendBtn.style.display = "block";
  bottomSendBtn.style.pointerEvents = (count === 0 && !repetible) ? "none" : "auto";
  bottomSendBtn.setAttribute("aria-hidden", (count === 0 && !repetible) ? "true" : "false");
  bottomSendBtn.tabIndex = (count === 0 && !repetible) ? -1 : 0;
  sendBtn.textContent = enviando ? "ENVIANDO…" : (count > 0 ? Aspecto.texto("enviar").toUpperCase() : (rounds.length ? "PEDIR ALGO MÁS" : "ESCOGE TUS PRODUCTOS"));
  sendBtn.disabled = bottomSendBtn.disabled = enviando;
  updateTabBadges();
}

function updateTabBadges(){
  catPanels.forEach((panel, idx) => {
    let sum = 0;
    panel.querySelectorAll(".line-item").forEach(row => {
      sum += cart[row.dataset.key] || 0;
    });
    [catTabButtons[idx], catTiles[idx]].forEach(el => {
      if(!el) return;
      const badge = el.querySelector(".tab-badge");
      if(sum > 0){
        badge.style.display = "inline-flex";
        badge.textContent = sum;
      } else {
        badge.style.display = "none";
      }
    });
  });
}

/* ---------------- PANEL ---------------- */
const overlay = document.getElementById("overlay");
const panel = document.getElementById("panel");
const panelBody = document.getElementById("panelBody");
const panelTotal = document.getElementById("panelTotal");

let showAllRounds = false;
/* Con barra y cocina separadas, un pedido llega a la base en dos partes
   (misma ronda). Al cliente eso no le importa (Carlos, v21): el tique junta
   las partes de cada ronda en un solo «PEDIDO N», como lo envió. Cada línea
   se sigue cambiando en su parte. Estado del pedido: ENVIADO si alguna parte
   lo está, EN PREPARACIÓN si alguna lo está, SERVIDO cuando lo están todas. */
function pedidosDelTique(lista){
  const grupos = [];
  lista.forEach(r => {
    let g = grupos.find(x => x.num === r.num);
    if(!g){ g = { num: r.num, partes: [] }; grupos.push(g); }
    g.partes.push(r);
  });
  grupos.forEach(g => {
    g.partes.sort((a, b) => a.orderId - b.orderId); // siempre en el mismo orden
    g.status = g.partes.some(r => r.status === 'enviado') ? 'enviado'
      : (g.partes.some(r => r.status === 'en_preparacion') ? 'en_preparacion' : 'servido');
  });
  return grupos;
}
// Parte que se puede cambiar durante más tiempo (para la cuenta atrás), o null.
function parteEditable(g){
  return g.partes.filter(roundEditable).sort((a, b) => b.editableHasta - a.editableHasta)[0] || null;
}
function appendRound(g, withDivider){
  if(withDivider) panelBody.appendChild(document.createElement("hr")).className = "round-divider";
  const editable = parteEditable(g);
  const label = document.createElement("div");
  const est = g.status === 'servido' ? "est-servido" : (g.status === 'en_preparacion' ? "est-prep" : "est-enviado");
  label.className = "round-label " + est + (editable ? " editable" : "");
  label.innerHTML = `<span>PEDIDO ${g.num} · ${roundLabel(g)}</span>`
    + (editable ? `<span class="cuenta" data-ronda="${g.num}">puedes cambiarlo ${cuentaAtras(editable)}</span>` : "");
  panelBody.appendChild(label);
  g.partes.forEach(round => {
    const sePuede = roundEditable(round);
    round.pintadaEditable = sePuede;
    round.lines.forEach(l => panelBody.appendChild(buildCartRow(l, l.qty === 0 ? "quitado" : (sePuede ? "sent" : "locked"), round)));
  });
}

function renderPanel(lines, total){
  panelBody.innerHTML = "";
  rounds.forEach(r => { r.pintadaEditable = false; });

  if(rounds.length === 0 && lines.length === 0){
    panelBody.innerHTML = `<div class="cart-empty">TIQUE VACÍO<br>${esc(Aspecto.texto("tique_vacio"))}</div>`;
    pintarMesaPedida();
    panelTotal.textContent = money(total);
    return;
  }

  // Visibles: pedidos enviados o en preparación y el que se está escogiendo.
  // Ocultos tras "Ver pedidos anteriores": los ya servidos.
  const pedidos = pedidosDelTique(rounds);
  let visible = pedidos.filter(g => g.status !== 'servido');
  if(visible.length === 0 && lines.length === 0 && pedidos.length > 0){
    visible = [pedidos[pedidos.length - 1]]; // si todo está servido, se enseña el último para que el tique no quede vacío
  }
  const hidden = pedidos.length - visible.length;
  if(showAllRounds){
    pedidos.forEach((g, idx) => appendRound(g, idx > 0));
  } else {
    visible.forEach((g, idx) => appendRound(g, idx > 0));
  }

  if(lines.length > 0){
    if((showAllRounds ? pedidos.length : visible.length) > 0) panelBody.appendChild(document.createElement("hr")).className = "round-divider";
    const label = document.createElement("div");
    label.className = "round-label current";
    const siguiente = rounds.reduce((m, r) => Math.max(m, r.num || 0), 0) + 1;
    label.textContent = MESA ? "PEDIDO " + siguiente + " · SIN ENVIAR" : "TU PEDIDO";
    panelBody.appendChild(label);
    lines.forEach(l => panelBody.appendChild(buildCartRow(l, "current")));
  }

  // Otra ronda (v30): en el tique, repetir el último pedido.
  const u = lines.length === 0 ? ultimoPedido() : null;
  if(u){
    const b = document.createElement("button");
    b.type = "button"; b.className = "repetir-btn";
    b.innerHTML = `<b>↻ Pedir otra igual</b><span>${esc(resumenPedido(u))}</span>`;
    b.addEventListener("click", repetirPedido);
    panelBody.appendChild(b);
  }

  if(hidden > 0 || showAllRounds){
    const t = document.createElement("button");
    t.className = "prev-toggle";
    t.textContent = showAllRounds ? "Ocultar pedidos anteriores" : "Ver pedidos anteriores (" + hidden + ")";
    t.addEventListener("click", () => { showAllRounds = !showAllRounds; updateCartBar(); });
    panelBody.appendChild(t);
  }

  pintarMesaPedida();
  panelTotal.textContent = money(total);
}

/* ---------------- LO PEDIDO EN TU MESA (v31, opción pedido_mesa) ----------------
   Al final del tique, lo que lleva pedido hoy toda la mesa (de todos los
   móviles y lo que haya metido el camarero), sin cobrar: así nadie pide
   dos veces lo mismo. No dice quién pidió qué. Lo da la base con el código
   del QR; se pregunta al abrir el tique y cada 15 s mientras está abierto. */
let MESA_PEDIDO = null;
let firmaMesa = "";
let pidiendoMesa = false;
async function refrescarMesaPedida(){
  if(!MESA || !opcion("pedido_mesa") || pidiendoMesa) return false;
  pidiendoMesa = true;
  try {
    const r = await datosCarta.pedidoMesa(MESA.id, MESA_CODIGO);
    const firma = JSON.stringify(r);
    const cambio = firma !== firmaMesa;
    firmaMesa = firma;
    MESA_PEDIDO = r;
    return cambio;
  } catch(e) {
    return false; // sin cobertura: se queda lo que había
  } finally { pidiendoMesa = false; }
}
function pintarMesaPedida(){
  if(!MESA || !opcion("pedido_mesa") || !MESA_PEDIDO || !Array.isArray(MESA_PEDIDO.lineas) || !MESA_PEDIDO.lineas.length) return;
  const caja = document.createElement("div");
  caja.className = "mesa-pedida";
  const n = Number(MESA_PEDIDO.pedidos) || 0;
  caja.innerHTML = `<div class="mp-cab"><b>EN TU MESA HOY</b><span>${n === 1 ? "1 pedido" : n + " pedidos"} · de todos los móviles</span></div>`;
  MESA_PEDIDO.lineas.forEach(l => caja.appendChild(buildCartRow({ qty: Number(l.cantidad), name: l.nombre, price: Number(l.precio) }, "mesa")));
  const t = document.createElement("div");
  t.className = "mp-total";
  t.innerHTML = `<span>Total de la mesa</span><span>${money(Number(MESA_PEDIDO.total) || 0)}</span>`;
  caja.appendChild(t);
  panelBody.appendChild(caja);
}
setInterval(async () => {
  if(document.hidden || !panel.classList.contains("show") || editando) return;
  if(await refrescarMesaPedida()) updateCartBar();
}, 15000);

function buildCartRow(l, mode, round){
  const row = document.createElement("div");
  row.className = "cart-row" + (mode === "locked" ? " past" : "") + (mode === "quitado" ? " quitado" : "");
  row.innerHTML = `
    <div class="cr-main">
      <div class="cr-name-row">
        <span class="cr-name">${l.qty} × ${esc(l.name)}</span>
        <span class="cr-dots"></span>
        <span class="cr-price">${money(l.qty*l.price)}</span>
      </div>
      ${l.note && mode !== "quitado" ? `<span class="cr-note">${esc(l.note)}</span>` : ""}
    </div>
  `;
  if(mode === "sent"){
    const stepper = document.createElement("div");
    stepper.className = "cr-stepper";
    stepper.innerHTML = `<button class="minus" aria-label="Quitar uno">−</button><button class="plus" aria-label="Añadir uno">+</button>`;
    const plusBtn = stepper.querySelector(".plus");
    const prod = PRODUCTS_BY_ID[l.key];
    if(l.qty >= MAX_UDS || (prod && prod.agotado)) plusBtn.disabled = true;
    stepper.querySelector(".minus").addEventListener("click", () => adjustSentItem(round, l, -1));
    plusBtn.addEventListener("click", () => adjustSentItem(round, l, 1));
    row.appendChild(stepper);
    // El precio, al final del renglón también en las líneas con − / + (v21)
    row.appendChild(row.querySelector(".cr-price"));
  }
  return row;
}

async function openPanel(){
  overlay.classList.add("show"); panel.classList.add("show");
  updateCartBar();
  const cambios = await Promise.all([refreshRoundStatuses(), refrescarMesaPedida()]);
  if(cambios[0] || cambios[1]) updateCartBar();
}

// Mientras haya pedidos sin servir, se pregunta a la base cada 6 s por su estado.
let pollBusy = false;
async function livePoll(){
  if(pollBusy || editando || document.hidden || !MESA) return;
  if(!rounds.some(r => r.status !== 'servido')) return;
  pollBusy = true;
  try {
    if(await refreshRoundStatuses()) updateCartBar();
  } finally { pollBusy = false; }
}
setInterval(livePoll, 6000);

// Cuenta atrás de "puedes cambiarlo m:ss"; al llegar a 0 se bloquea el pedido en pantalla.
setInterval(() => {
  let caducado = false;
  pedidosDelTique(rounds).forEach(g => {
    const el = panelBody.querySelector('.cuenta[data-ronda="' + g.num + '"]');
    if(!el) return;
    const r = parteEditable(g);
    if(r) el.textContent = "puedes cambiarlo " + cuentaAtras(r);
    else caducado = true;
  });
  // Una parte que deja de poderse cambiar mientras la otra sigue: se repinta para bloquear sus líneas.
  if(rounds.some(r => r.pintadaEditable && !roundEditable(r))) caducado = true;
  if(caducado && !editando) updateCartBar();
}, 1000);

function alVolver(){ livePoll(); refrescarCarta(); revisarMesa(); }
document.addEventListener("visibilitychange", () => { if(!document.hidden) alVolver(); });
window.addEventListener("focus", livePoll);
window.addEventListener("online", alVolver);
function closePanel(){ overlay.classList.remove("show"); panel.classList.remove("show"); }
document.getElementById("openCartBtn").addEventListener("click", openPanel);
document.getElementById("closePanelBtn").addEventListener("click", closePanel);
overlay.addEventListener("click", closePanel);

/* ---------------- PRECIOS Y AGOTADOS AL DÍA ----------------
   Cada minuto (y al volver a la carta) se leen de la base los precios y
   los agotados, sin recargar la página. Un producto nuevo o retirado se
   verá al recargar. Si algo del pedido sin enviar se agota, se quita. */
let refrescandoCarta = false;
let ultimaCarta = 0;
async function refrescarCarta(){
  if(refrescandoCarta || !MENU.length || Date.now() - ultimaCarta < 20000) return;
  refrescandoCarta = true;
  try {
    const menu = await datosCarta.menu();
    if(!Array.isArray(menu) || !menu.length) return;
    ultimaCarta = Date.now();
    MENU_DE_BASE = true;
    const quitados = [], fueraHora = [];
    menu.forEach(c => {
      if(catInfo[c.id]){ catInfo[c.id].horario = c.horario || null; catInfo[c.id].abierta = c.abierta !== false; pintarHorario(c.id); }
      (c.items || []).forEach(n => {
        const key = String(n.dbId);
        const it = PRODUCTS_BY_ID[key];
        if(!it) return;
        it.p = Number(n.p);
        it.agotado = !!n.agotado;
        it.fuera = c.abierta === false;
        if(it.agotado && cart[key]){ delete cart[key]; delete notes[key]; quitados.push(it.n); }
        else if(it.fuera && cart[key]){ delete cart[key]; delete notes[key]; fueraHora.push(it.n); }
        pintarControles(key);
      });
    });
    updateCartBar();
    if(quitados.length){
      aviso("SE HA AGOTADO", "Lo sentimos, se ha agotado: " + quitados.join(", ") + ". Lo hemos quitado de tu pedido.");
    } else if(fueraHora.length){
      aviso("FUERA DE HORARIO", "A esta hora ya no se sirve: " + fueraHora.join(", ") + ". Lo hemos quitado de tu pedido.");
    }
  } catch(e) {
    // sin conexión: se queda la carta que había
  } finally { refrescandoCarta = false; }
}
setInterval(() => { if(!document.hidden) refrescarCarta(); }, 60000);

/* ---------------- AVISOS (pedido enviado, errores) ---------------- */
const confirmEl = document.getElementById("confirm");
const confirmText = document.getElementById("confirmText");
const confirmMark = confirmEl.querySelector(".stamp-mark");
let confirmTimer;
function aviso(titulo, texto, soloUnRato){
  confirmMark.textContent = titulo;
  confirmText.textContent = texto;
  confirmEl.classList.add("show");
  clearTimeout(confirmTimer);
  if(soloUnRato) confirmTimer = setTimeout(() => confirmEl.classList.remove("show"), 4500);
}
document.getElementById("confirmClose").addEventListener("click", () => {
  clearTimeout(confirmTimer);
  confirmEl.classList.remove("show");
});

/* ---------------- LLAMAR AL CAMARERO / PEDIR LA CUENTA (v15) ----------------
   Opción del bar (ajustes.avisos_mesa). Solo con el QR de la mesa: el aviso
   sale en el panel hasta que el personal pulsa «Atendido». La base no
   repite un aviso igual sin atender y limita los avisos por mesa. */
const llamarBtn = document.getElementById("llamarBtn");
const llamarTiqueBtn = document.getElementById("llamarTiqueBtn"); // el mismo botón, dentro del tique (v20)
const llamarHoja = document.getElementById("llamarHoja");
function pintarLlamar(){
  const activo = !!(BAR_INFO && BAR_INFO.ajustes && BAR_INFO.ajustes.avisos_mesa);
  llamarBtn.hidden = llamarTiqueBtn.hidden = !(activo && MESA);
}
// «Pedir la cuenta» solo si este móvil ya ha hecho algún pedido (v17):
// sin pedidos no hay nada que cobrar, solo se puede llamar al camarero.
function abrirLlamar(){
  llamarHoja.querySelector('.ll-op[data-tipo="cuenta"]').hidden = rounds.length === 0;
  llamarHoja.classList.add("show");
}
llamarBtn.addEventListener("click", abrirLlamar);
llamarTiqueBtn.addEventListener("click", abrirLlamar);
document.getElementById("llamarCancelar").addEventListener("click", () => llamarHoja.classList.remove("show"));
llamarHoja.addEventListener("click", (ev) => { if(ev.target === llamarHoja) llamarHoja.classList.remove("show"); });
let llamando = false;
llamarHoja.querySelectorAll(".ll-op").forEach(b => b.addEventListener("click", async () => {
  if(llamando || !MESA) return;
  llamando = true;
  const tipo = b.dataset.tipo;
  try {
    await datosCarta.aviso(MESA.id, MESA_CODIGO, tipo);
    llamarHoja.classList.remove("show");
    aviso("AVISO ENVIADO", tipo === "cuenta" ? "Te llevamos la cuenta enseguida (" + MESA.nombre + ")." : "El camarero viene enseguida (" + MESA.nombre + ").", true);
  } catch(err) {
    llamarHoja.classList.remove("show");
    if(err.codigo === 'MESA_CERRADA'){ MESA.cerrada = true; pintarMesa(); }
    aviso("NO SE HA ENVIADO", err.message);
  } finally { llamando = false; }
}));

/* ---------------- ENVIAR EL PEDIDO ---------------- */
function vaciarCarrito(){
  Object.keys(cart).forEach(k => { delete cart[k]; delete notes[k]; });
  Object.keys(rowRefs).forEach(pintarControles);
}

async function sendOrder(){
  const lines = cartLines();
  if(lines.length === 0){ openPanel(); return; }
  if(!MESA || enviando) return;
  if(lines.length > 30){ aviso("PEDIDO MUY LARGO", textoError('DEMASIADAS_LINEAS')); return; }
  const lineas = lines.map(l => ({ producto: Number(l.key), cantidad: l.qty, nota: (l.note || "").trim().slice(0, 140) }));
  const antes = rounds.length;
  enviando = true;
  updateCartBar();
  let p = null, fallo = null;
  try {
    p = await datosCarta.crearPedido(MESA.id, MESA_CODIGO, lineas);
  } catch(err) {
    fallo = err;
  }
  if(fallo && fallo.codigo === 'SIN_CONEXION'){
    // Con mala cobertura puede haber llegado aunque no llegue la respuesta: se comprueba.
    await refreshRoundStatuses();
    if(rounds.length > antes){ p = { ronda: rounds[rounds.length - 1].num }; fallo = null; }
  }
  enviando = false;
  if(p){
    if(MESA.cerrada){ MESA.cerrada = false; pintarMesa(); }
    // Con barra y cocina separadas, el pedido llega en dos partes (v15).
    const partes = Array.isArray(p.partes) && p.partes.length ? p.partes : (p.id ? [p] : []);
    partes.forEach(x => rounds.push(aRonda(x)));
    vaciarCarrito();
    closePanel();
    updateCartBar();
    refrescarMesaPedida().then(c => { if(c) updateCartBar(); });
    aviso("PEDIDO ENVIADO", "Pedido " + p.ronda + " enviado (" + MESA.nombre + "). Durante 3 minutos puedes cambiarlo desde «Ver tique».", true);
    return;
  }
  if(fallo.codigo === 'AGOTADO' || fallo.codigo === 'FUERA_DE_HORARIO'){ ultimaCarta = 0; await refrescarCarta(); }
  if(fallo.codigo === 'MESA_NO_VALIDA') desactivarPedidos();
  if(fallo.codigo === 'MESA_CERRADA'){ MESA.cerrada = true; pintarMesa(); updateCartBar(); aviso("MESA CERRADA", fallo.message); return; }
  updateCartBar();
  aviso("NO SE HA ENVIADO", fallo.message);
}
sendBtn.addEventListener("click", () => {
  if(cartLines().length === 0){
    closePanel();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else {
    sendOrder();
  }
});
bottomSendBtn.addEventListener("click", () => {
  if(cartLines().length === 0 && bottomSendBtn.classList.contains("repetir")){ repetirPedido(); return; }
  if(cartLines().length === 0){
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else {
    sendOrder();
  }
});

/* ---------------- MESA (del QR: /carta/?mesa=5&c=CÓDIGO) ----------------
   Con mesa y código correctos la carta deja enviar el pedido a la barra.
   Sin ellos (por ejemplo, entrando desde la portada) solo se mira y el
   tique se enseña al camarero, como antes. */
const PARAMS = new URLSearchParams(window.location.search);
const MESA_NUM = /^\d{1,3}$/.test(PARAMS.get("mesa") || "") ? Number(PARAMS.get("mesa")) : null;
const MESA_CODIGO = (PARAMS.get("c") || "").trim();
let MESA = null; // {id, nombre} cuando se puede pedir

const heroLine = document.querySelector(".hero-line");
let QR_INVALIDO = false;
function activarPedidos(m){
  MESA = m;
  document.body.classList.add("modo-pedir");
  pintarTextos();
  pintarLlamar();
  pintarMesa();
}
// Control de mesas (opción del bar): si el camarero no ha abierto la mesa,
// se avisa arriba; la base no deja enviar hasta que la abra.
function pintarMesa(){
  if(!MESA) return;
  heroLine.innerHTML = MESA.cerrada
    ? '<b class="mesa-tag">' + esc(MESA.nombre) + ' cerrada</b> · Avisa al camarero'
    : '<b class="mesa-tag">' + esc(MESA.nombre) + '</b> · Pide desde tu mesa';
}
// Vuelve a preguntar si la mesa está abierta (al volver a la carta, cada minuto y al fallar un envío).
async function revisarMesa(){
  if(!MESA || !MESA.cerrada) return;
  try {
    const m = await datosCarta.mesa(MESA_NUM, MESA_CODIGO);
    if(m && m.id){ MESA.cerrada = !!(m.control && !m.abierta); pintarMesa(); }
  } catch(e) { /* sin conexión: se queda como estaba */ }
}
setInterval(() => { if(!document.hidden) revisarMesa(); }, 60000);
function desactivarPedidos(){
  MESA = null;
  rounds.length = 0;
  document.body.classList.remove("modo-pedir");
  pintarTextos();
  pintarLlamar();
  QR_INVALIDO = true;
  heroLine.innerHTML = '<b class="mesa-tag">QR no válido</b> · Avisa al camarero';
}
async function comprobarMesa(){
  if(!MESA_NUM || !MESA_CODIGO) return;
  let m = null, sinRespuesta = false;
  try { m = await conTiempo(datosCarta.mesa(MESA_NUM, MESA_CODIGO), 8000); } catch(e) { sinRespuesta = true; }
  if(m && m.id) activarPedidos({ id: m.id, nombre: m.nombre || ("Mesa " + m.id), cerrada: !!(m.control && !m.abierta) });
  // Sin cobertura ahora mismo: se deja pedir y la base comprobará el código al enviar.
  else if(sinRespuesta) activarPedidos({ id: MESA_NUM, nombre: "Mesa " + MESA_NUM });
  else desactivarPedidos();
  if(MESA) await refreshRoundStatuses();
}

/* ---------------- INIT ---------------- */
async function init(){
  menuEl.innerHTML = `<div class="cart-empty" style="padding:40px 0;">Cargando la carta...</div>`;
  pintarTextos();
  const barListo = loadBar();
  const mesaLista = comprobarMesa();
  try {
    await loadMenu();
    // Las opciones del bar (v30) deciden cómo se pinta la carta: se espera a saberlas.
    await conTiempo(barListo, 7000).catch(() => {});
    if(MENU_DE_BASE) ultimaCarta = Date.now();
    menuEl.innerHTML = "";
    renderCategories();
    Object.keys(rowRefs).forEach(pintarControles);
  } catch(err) {
    if(err.codigo === 'BAR_NO_VALIDO'){ menuEl.innerHTML = `<div class="cart-empty" style="padding:40px 0;">${esc(err.message)}</div>`; await mesaLista; return; }
    menuEl.innerHTML = `<div class="cart-empty" style="padding:40px 0;">No se pudo cargar la carta.<br>Comprueba tu conexión y recarga la página.<br><span style="font-size:10px;">${esc(err.message)}</span></div>`;
  }
  await mesaLista;
  CARTA_LISTA = true;
  updateCartBar();
  mostrarBienvenida();
}

/* Bienvenida (v30, opción bienvenida): la primera vez que alguien abre la
   carta con el QR de la mesa, tres pasos para que sepa que puede pedir desde
   aquí. Solo sale una vez en cada móvil (por bar). */
function mostrarBienvenida(){
  if(!MESA || !opcion("bienvenida")) return;
  try { if(leerLocal("carta.bienvenida." + BAR)) return; } catch(e) { return; }
  const el = document.createElement("div");
  el.className = "ficha-foto bienvenida";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.innerHTML = `<div class="ff-caja bv-caja"><div class="ff-texto">
      <div class="bv-mesa">${esc(MESA.nombre)}</div>
      <div class="ff-nombre">Pide desde tu móvil</div>
      <ol class="bv-pasos">
        <li><b>Elige</b> lo que quieras y toca <b>+</b></li>
        <li><b>Envía el pedido</b>: llega directo a la barra</li>
        <li><b>Pagas al final</b>, como siempre</li>
      </ol>
      <button type="button" class="ff-anadir bv-ok">Empezar</button>
    </div></div>`;
  const cerrar = () => { el.remove(); try { guardarLocal("carta.bienvenida." + BAR, 1); } catch(e) {} };
  el.addEventListener("click", ev => { if(ev.target === el || ev.target.closest(".bv-ok")) cerrar(); });
  document.body.appendChild(el);
}
init();

/* ---------------- FOTO DE PRODUCTO ---------------- */
/* Fotos de los productos (v26, opción ajustes.fotos): al tocar la miniatura
   se abre la foto en grande con el nombre, la descripción y, por cada tamaño,
   su precio y «Añadir». Se cierra tocando fuera o con la ✕. */
const fichaEl = document.createElement("div");
fichaEl.className = "ficha-foto";
fichaEl.hidden = true;
fichaEl.setAttribute("role", "dialog");
fichaEl.setAttribute("aria-modal", "true");
document.body.appendChild(fichaEl);
function cerrarFicha(){ fichaEl.hidden = true; fichaEl.innerHTML = ""; }
fichaEl.addEventListener("click", ev => { if(ev.target === fichaEl || ev.target.closest(".ff-cerrar")) cerrarFicha(); });
document.addEventListener("keydown", ev => { if(ev.key === "Escape" && !fichaEl.hidden) cerrarFicha(); });
function abrirFicha(items){
  const a = items[0];
  const foto = (items.find(x => x.img) || a).img;
  const nombre = a.dn || a.n;
  const desc = items.every(x => x.d === a.d) ? a.d : "";
  fichaEl.innerHTML = `<div class="ff-caja">
      <button type="button" class="ff-cerrar" aria-label="Cerrar">✕</button>
      <img class="ff-img" src="${esc(foto)}" alt="${esc(nombre)}">
      <div class="ff-texto">
        <div class="ff-nombre">${esc(nombre)}</div>
        ${desc ? `<div class="ff-desc">${esc(desc)}</div>` : ""}
        ${items.map(x => `<div class="ff-fila">
            <span class="ff-tam">${esc(x.size || "")}</span>
            <span class="ff-precio">${money(x.p)}</span>
            <button type="button" class="ff-anadir" data-key="${esc(String(x.dbId))}"></button>
          </div>`).join("")}
      </div>
    </div>`;
  const pintar = () => fichaEl.querySelectorAll(".ff-anadir").forEach(b => {
    const it = PRODUCTS_BY_ID[b.dataset.key];
    const q = cart[b.dataset.key] || 0;
    b.disabled = bloqueado(it) || q >= MAX_UDS;
    b.textContent = it && it.agotado ? "Agotado" : (it && it.fuera ? "Fuera de horario" : (q ? "Añadido · " + q : "Añadir"));
    b.classList.toggle("hecho", q > 0);
  });
  fichaEl.querySelectorAll(".ff-anadir").forEach(b => b.addEventListener("click", () => {
    const key = b.dataset.key;
    if(bloqueado(PRODUCTS_BY_ID[key]) || (cart[key] || 0) >= MAX_UDS) return;
    cart[key] = (cart[key] || 0) + 1;
    renderControls(key);
    pintar();
  }));
  pintar();
  fichaEl.hidden = false;
  fichaEl.querySelector(".ff-cerrar").focus({ preventScroll: true });
}



/* ---------------- CABECERA FIJA ---------------- */
(function(){
  const st = document.querySelector(".sticky-top");
  function fit(){ document.body.style.paddingTop = st.offsetHeight + "px"; }
  fit();
  window.addEventListener("resize", fit);
  window.addEventListener("load", fit);
  if(window.ResizeObserver){ new ResizeObserver(fit).observe(st); }
  if(document.fonts && document.fonts.ready){ document.fonts.ready.then(fit); }
})();
