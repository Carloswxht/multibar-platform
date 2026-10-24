/* =====================================================================
   AVISO LEGAL Y PRIVACIDAD · MultiBar
   El texto es el mismo para todos los bares; los datos del titular salen
   de la base (carta_bar → ajustes.legal) o, sin conexión, de la copia de
   reserva datos/bares/<bar>/bar.json.
   ajustes.legal = { titular, nif, domicilio, email, telefono?, registro? }
   Plantilla: revisar con un asesor antes de usarla con clientes reales.
   ===================================================================== */

const ACTUALIZADO = '24 de octubre de 2026';

function esc(t){
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function leerBar(){
  try { return await datosCarta.bar(); }
  catch(e) {
    if(e.codigo === 'BAR_NO_VALIDO') return null;
    try { const r = await fetch('../datos/bares/' + BAR + '/bar.json', { cache: 'no-cache' }); if(r.ok) return await r.json(); }
    catch(e2) { /* sin reserva */ }
    return null;
  }
}

function pintar(bar){
  const main = document.getElementById('contenido');
  if(!bar){ Aspecto.aplicar(null); main.innerHTML = '<p class="vacio">No se encuentra este bar.</p>'; return; }
  Aspecto.aplicar(bar); // colores, fuentes y logo del bar (comun/aspecto.js)
  document.getElementById('local').textContent = bar.nombre;
  document.getElementById('volver').href = '../carta/?bar=' + encodeURIComponent(bar.slug || BAR);
  document.title = 'Aviso legal y privacidad · ' + bar.nombre;
  const L = (bar.ajustes && bar.ajustes.legal) || null;
  if(!L || !L.titular || !L.nif || !L.email){
    main.innerHTML = '<p class="vacio">Esta información todavía no está disponible.<br>Si la necesitas, pregunta al personal del local.</p>';
    return;
  }
  const n = esc(bar.nombre), tit = esc(L.titular);
  const datos = `<div class="datos">
      <div><b>Titular:</b> ${tit}</div>
      <div><b>NIF:</b> ${esc(L.nif)}</div>
      ${L.domicilio ? `<div><b>Domicilio:</b> ${esc(L.domicilio)}</div>` : ''}
      <div><b>Correo:</b> <a href="mailto:${esc(L.email)}">${esc(L.email)}</a></div>
      ${L.telefono ? `<div><b>Teléfono:</b> ${esc(L.telefono)}</div>` : ''}
      ${L.registro ? `<div><b>Datos registrales:</b> ${esc(L.registro)}</div>` : ''}
    </div>`;

  main.innerHTML = `
  <h2 id="aviso">Aviso legal</h2>
  <p>En cumplimiento de la Ley 34/2002, de servicios de la sociedad de la información y de comercio electrónico (LSSI-CE), estos son los datos del titular de esta carta digital:</p>
  ${datos}

  <h3>Qué es esta web</h3>
  <p>Es la carta digital de ${n}. Sirve para consultar los productos y sus precios y, si entras con el código QR de tu mesa, para enviar tu pedido a la barra. El pago se hace en el local.</p>

  <h3>Precios, disponibilidad y alérgenos</h3>
  <p>Los precios incluyen IVA. Los productos agotados aparecen marcados y no se pueden pedir. Si tienes alguna alergia o intolerancia alimentaria, <b>pregunta al personal antes de pedir</b>: te informará de los alérgenos de cada plato.</p>

  <h3>Uso de la web</h3>
  <p>Te pedimos que la uses de buena fe: enviar pedidos falsos o intentar acceder a zonas reservadas al personal no está permitido. Hacemos lo posible por que la web funcione siempre, pero puede haber cortes puntuales; en ese caso, pide directamente al personal.</p>

  <h3>Propiedad intelectual</h3>
  <p>Los textos, nombres y contenidos de la carta pertenecen a ${tit}. La plataforma tecnológica es MultiBar, de autonomIA Lab.</p>

  <h3>Ley aplicable</h3>
  <p>Esta web se rige por la legislación española.</p>

  <h2 id="privacidad">Política de privacidad</h2>

  <h3>Responsable del tratamiento</h3>
  ${datos}
  <p>autonomIA Lab (<a href="https://www.autonomialab.es" target="_blank" rel="noopener">www.autonomialab.es</a>) presta el servicio tecnológico como <b>encargado del tratamiento</b>, por cuenta de ${tit} y con un contrato que le obliga a tratar los datos solo para este servicio.</p>

  <h3>Si eres cliente</h3>
  <ul>
    <li><b>No te pedimos nombre, teléfono ni correo.</b> Para pedir no hace falta registrarse.</li>
    <li>Al enviar un pedido guardamos la mesa, los productos, la hora y, si las escribes, las notas para cocina. <b>No escribas datos personales en las notas.</b></li>
    <li>Tu móvil genera un número al azar que se guarda en tu navegador para que puedas ver y cambiar tus propios pedidos. No te identifica.</li>
    <li>Para servir tu pedido (art. 6.1.b del RGPD) y para proteger el servicio contra abusos, como pedidos repetidos en poco tiempo (art. 6.1.f, interés legítimo).</li>
    <li><b>Cuánto tiempo:</b> las notas se borran a las 24 horas y los pedidos a los 30 días.</li>
  </ul>

  <h3>Si eres del personal del local</h3>
  <ul>
    <li>Guardamos tu nombre, tu correo, tu función (camarero, barra o encargado) y tu contraseña cifrada (nunca en claro), para darte acceso al panel y registrar qué pedidos atiendes.</li>
    <li>Si pides recuperar tu contraseña, usamos tu correo solo para mandarte el enlace (sirve una sola vez y caduca al poco tiempo).</li>
    <li>Base legal: tu relación con el local (art. 6.1.b del RGPD). Se conservan mientras tengas acceso al panel.</li>
  </ul>

  <h3>Proveedores</h3>
  <ul>
    <li><b>Supabase</b>: base de datos, con servidores en la Unión Europea (Fráncfort, Alemania).</li>
    <li><b>Resend</b> (EE. UU., envío desde la Unión Europea): manda los correos para recuperar la contraseña del personal. Solo recibe el correo, el nombre y el enlace.</li>
    <li><b>GitHub Pages</b> (GitHub Inc., EE. UU.): aloja las páginas de la web y, como cualquier servidor, registra datos técnicos de la conexión, como la dirección IP. Estas transferencias cuentan con las garantías previstas en el RGPD.</li>
  </ul>
  <p>No vendemos ni cedemos tus datos a nadie, salvo obligación legal.</p>

  <h3>Cookies y almacenamiento en tu navegador</h3>
  <p>No usamos cookies de publicidad ni de analítica. La web solo guarda en tu navegador lo imprescindible para funcionar: el número al azar de tu móvil, el nombre y el aspecto del local (colores y logo) y, si eres del personal, tu sesión. Al ser técnico y necesario, no requiere tu consentimiento.</p>

  <h3>Tus derechos</h3>
  <p>Puedes pedir el acceso, la rectificación, la supresión, la oposición, la limitación o la portabilidad de tus datos escribiendo a <a href="mailto:${esc(L.email)}">${esc(L.email)}</a>. Si crees que no hemos atendido bien tu petición, puedes reclamar ante la Agencia Española de Protección de Datos (<a href="https://www.aepd.es" target="_blank" rel="noopener">www.aepd.es</a>).</p>

  <p class="nota">Última actualización: ${ACTUALIZADO}.</p>`;

  if(location.hash){ const d = document.getElementById(location.hash.slice(1)); if(d) d.scrollIntoView(); }
}

leerBar().then(pintar);
