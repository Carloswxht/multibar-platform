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
    PRODUCTS_BY_ID[String(it.dbId)] = it;
  }));
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
function pintarBar(info){
  if(!info || !info.nombre) return;
  BAR_INFO = info;
  // Colores, fuentes, logo, icono para instalar y textos del bar (comun/aspecto.js).
  Aspecto.aplicar(info, { instalable: true });
  pintarTextos();
  pintarLlamar();
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
  row.innerHTML = `
    <div class="li-main">
      <div class="li-name-row">
        ${it.pop ? '<span class="li-star">★</span>' : ""}
        ${it.lab ? `<span class="li-sublab">${esc(it.lab)}</span>` : `<span class="li-name">${esc(it.dn || it.n)}</span>`}
        ${it.lab ? "" : (it.d ? `<span class="li-sub">${esc(it.d)}</span>` : "")}
        ${it.al ? `<span class="li-allergens">${it.al.map(a => `[${esc(a)}]`).join(" ")}</span>` : ""}
      </div>
      <div class="li-pricerow">${it.img ? `<button type="button" class="ver-btn" aria-label="Ver foto"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l1.6-2.2h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.6"/></svg><span>FOTO</span></button>` : ""}<span class="li-price">${money(it.p)}</span></div>
    </div>
    <span class="li-connector"></span>
    <span class="li-ctrl"></span>
  `;

  const vb = row.querySelector(".ver-btn");
  if(vb){
  const hold = e => { e.preventDefault(); try{ vb.setPointerCapture(e.pointerId); }catch(_){} vb.classList.add("on"); openPhoto(it); };
  const rel = () => { vb.classList.remove("on"); closePhoto(); };
  vb.addEventListener("pointerdown", hold);
  vb.addEventListener("pointerup", rel);
  vb.addEventListener("pointercancel", rel);
  vb.addEventListener("lostpointercapture", rel);
  vb.addEventListener("contextmenu", e => e.preventDefault());
  }

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
    if(PRODUCTS_BY_ID[key].agotado) return;
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
    if(PRODUCTS_BY_ID[key].agotado || (cart[key]||0) >= MAX_UDS) return;
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
  const agotado = !!PRODUCTS_BY_ID[key].agotado;
  (rowRefs[key] || []).forEach(r => {
    if(r.row) r.row.classList.toggle("agotado", agotado);
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

function addCategory(id, name, buildItems){
  const tab = document.createElement("button");
  tab.className = "cat-tab";
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
  buildItems(panel);
  const n = panel.querySelectorAll(".line-item").length;
  head.querySelector(".cat-count").textContent = n === 1 ? "1 producto" : n + " productos";
  if(!panel.querySelector(".li-allergens")) head.style.display = "none";
  menuEl.appendChild(panel);
  catPanels.push(panel);

  tab.addEventListener("click", () => {
    catTabButtons.forEach(t => t.classList.remove("active"));
    catPanels.forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    panel.classList.add("active");
    // Cada pestaña empieza en su primer producto (si estabas más abajo, se sube al principio).
    if(window.scrollY > 0) window.scrollTo(0, 0);
    tab.scrollIntoView({behavior:"smooth", block:"nearest", inline:"center"});
  });
}

function renderCategories(){
  MENU.forEach(sec => {
    addCategory(sec.id, sec.name, (wrap) => {
      let last = null;
      const its = sec.items;
      for(let i = 0; i < its.length; ){
        const it = its[i];
        if(sec.multi && it.sec !== last){ last = it.sec; const cp = document.createElement("div"); cp.className = "sec-cap"; cp.textContent = it.sec.charAt(0) + it.sec.slice(1).toLowerCase(); wrap.appendChild(cp); }
        let j = i + 1;
        if(it.size && !it.only){ while(j < its.length && its[j].dn === it.dn && its[j].size && !its[j].only) j++; }
        if(j - i > 1){
          const grp = its.slice(i, j);
          const common = grp.every(x => x.d === grp[0].d);
          const g = document.createElement("div"); g.className = "vgroup";
          const h = document.createElement("div"); h.className = "vhead";
          h.innerHTML = '<span class="li-name">' + esc(it.dn) + '</span>' + (common && it.d ? '<span class="li-sub">' + esc(it.d) + '</span>' : "");
          g.appendChild(h);
          grp.forEach(x => { const o = Object.assign({}, x, {lab: x.size + (!common && x.d ? " · " + x.d : "")}); const w = buildLine(o); g.appendChild(w); });
          wrap.appendChild(g);
        } else {
          wrap.appendChild(buildLine(it));
        }
        i = j;
      }
    });
  });

  catTabButtons[0].classList.add("active");
  catPanels[0].classList.add("active");
}

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
  if(lineas.length === 0 && !window.confirm("¿Anular el pedido " + round.num + "? Se borra y no llega a la barra.")) return;
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
  }
}

const cartCountLbl = document.getElementById("cartCountLbl");
const cartTotalLbl = document.getElementById("cartTotalLbl");
const bottomSendBtn = document.getElementById("bottomSendBtn");
const sendBtn = document.getElementById("sendBtn");
let enviando = false;

function updateCartBar(){
  const lines = cartLines();
  const count = cartCount(lines);
  const currentTotal = cartTotal(lines);
  const grandTotal = rounds.reduce((s,r) => s + r.total, 0) + currentTotal;
  cartCountLbl.textContent = count === 1 ? "1 línea" : count + " líneas";
  cartTotalLbl.textContent = money(currentTotal);
  renderPanel(lines, grandTotal);
  // Sin productos: de la barra de enviar solo queda una línea fina encima de la barra azul
  bottomSendBtn.textContent = enviando ? "Enviando…" : (count === 0 ? "" : Aspecto.texto("enviar"));
  bottomSendBtn.classList.toggle("idle", count === 0 && !enviando);
  bottomSendBtn.style.display = "block";
  bottomSendBtn.style.pointerEvents = count === 0 ? "none" : "auto";
  bottomSendBtn.setAttribute("aria-hidden", count === 0 ? "true" : "false");
  bottomSendBtn.tabIndex = count === 0 ? -1 : 0;
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
    const badge = catTabButtons[idx].querySelector(".tab-badge");
    if(sum > 0){
      badge.style.display = "inline-flex";
      badge.textContent = sum;
    } else {
      badge.style.display = "none";
    }
  });
}

/* ---------------- PANEL ---------------- */
const overlay = document.getElementById("overlay");
const panel = document.getElementById("panel");
const panelBody = document.getElementById("panelBody");
const panelTotal = document.getElementById("panelTotal");

let showAllRounds = false;
function appendRound(round, withDivider){
  if(withDivider) panelBody.appendChild(document.createElement("hr")).className = "round-divider";
  const editable = roundEditable(round);
  const label = document.createElement("div");
  const est = round.status === 'servido' ? "est-servido" : (round.status === 'en_preparacion' ? "est-prep" : "est-enviado");
  label.className = "round-label " + est + (editable ? " editable" : "");
  label.innerHTML = `<span>PEDIDO ${round.num}${round.destino ? " · " + round.destino.toUpperCase() : ""} · ${roundLabel(round)}</span>`
    + (editable ? `<span class="cuenta" data-pedido="${round.orderId}">puedes cambiarlo ${cuentaAtras(round)}</span>` : "");
  panelBody.appendChild(label);
  round.lines.forEach(l => panelBody.appendChild(buildCartRow(l, l.qty === 0 ? "quitado" : (editable ? "sent" : "locked"), round)));
}

function renderPanel(lines, total){
  panelBody.innerHTML = "";

  if(rounds.length === 0 && lines.length === 0){
    panelBody.innerHTML = `<div class="cart-empty">TIQUE VACÍO<br>${esc(Aspecto.texto("tique_vacio"))}</div>`;
    panelTotal.textContent = money(total);
    return;
  }

  // Visibles: pedidos enviados o en preparación y el que se está escogiendo.
  // Ocultos tras "Ver pedidos anteriores": los ya servidos.
  let visible = rounds.filter(r => r.status !== 'servido');
  if(visible.length === 0 && lines.length === 0 && rounds.length > 0){
    visible = [rounds[rounds.length - 1]]; // si todo está servido, se enseña el último para que el tique no quede vacío
  }
  const hidden = rounds.length - visible.length;
  if(showAllRounds){
    rounds.forEach((round, idx) => appendRound(round, idx > 0));
  } else {
    visible.forEach((round, idx) => appendRound(round, idx > 0));
  }

  if(lines.length > 0){
    if((showAllRounds ? rounds.length : visible.length) > 0) panelBody.appendChild(document.createElement("hr")).className = "round-divider";
    const label = document.createElement("div");
    label.className = "round-label current";
    const siguiente = rounds.reduce((m, r) => Math.max(m, r.num || 0), 0) + 1;
    label.textContent = MESA ? "PEDIDO " + siguiente + " · SIN ENVIAR" : "TU PEDIDO";
    panelBody.appendChild(label);
    lines.forEach(l => panelBody.appendChild(buildCartRow(l, "current")));
  }

  if(hidden > 0 || showAllRounds){
    const t = document.createElement("button");
    t.className = "prev-toggle";
    t.textContent = showAllRounds ? "Ocultar pedidos anteriores" : "Ver pedidos anteriores (" + hidden + ")";
    t.addEventListener("click", () => { showAllRounds = !showAllRounds; updateCartBar(); });
    panelBody.appendChild(t);
  }

  panelTotal.textContent = money(total);
}

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
  if(await refreshRoundStatuses()) updateCartBar();
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
  rounds.forEach(r => {
    const el = panelBody.querySelector('.cuenta[data-pedido="' + r.orderId + '"]');
    if(!el) return;
    if(roundEditable(r)) el.textContent = "puedes cambiarlo " + cuentaAtras(r);
    else caducado = true;
  });
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
    const quitados = [];
    menu.forEach(c => (c.items || []).forEach(n => {
      const key = String(n.dbId);
      const it = PRODUCTS_BY_ID[key];
      if(!it) return;
      it.p = Number(n.p);
      it.agotado = !!n.agotado;
      if(it.agotado && cart[key]){ delete cart[key]; delete notes[key]; quitados.push(it.n); }
      pintarControles(key);
    }));
    updateCartBar();
    if(quitados.length){
      aviso("SE HA AGOTADO", "Lo sentimos, se ha agotado: " + quitados.join(", ") + ". Lo hemos quitado de tu pedido.");
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
    const destinos = partes.map(x => x.destino).filter(Boolean);
    const aQuien = destinos.length > 1 ? "a la barra y a la cocina" : (destinos[0] === "cocina" ? "a la cocina" : "a la barra");
    vaciarCarrito();
    closePanel();
    updateCartBar();
    aviso("PEDIDO ENVIADO", "Pedido " + p.ronda + " enviado " + aQuien + " (" + MESA.nombre + "). Durante 3 minutos puedes cambiarlo desde «Ver tique».", true);
    return;
  }
  if(fallo.codigo === 'AGOTADO'){ ultimaCarta = 0; await refrescarCarta(); }
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
  loadBar();
  const mesaLista = comprobarMesa();
  try {
    await loadMenu();
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
}
init();

/* ---------------- FOTO DE PRODUCTO ---------------- */
function openPhoto(it){
  const card = document.getElementById("photoCard");
  card.innerHTML = "";
  if(it.img){
    const im = document.createElement("img"); im.src = it.img; im.alt = it.n; card.appendChild(im);
  } else {
    const e = document.createElement("div"); e.className = "pc-empty"; e.textContent = "Foto próximamente"; card.appendChild(e);
  }
  const nm = document.createElement("div"); nm.className = "pc-name"; nm.textContent = it.n; card.appendChild(nm);
  if(it.d){ const sb = document.createElement("div"); sb.className = "pc-sub"; sb.textContent = it.d; card.appendChild(sb); }
  document.getElementById("photoModal").classList.add("open");
}
function closePhoto(){ document.getElementById("photoModal").classList.remove("open"); }



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
