# La Mar de Gambas · ficha del bar (bar nº 1, slug `lamardegambas`)

**La Mar de Gambas Cervecerías** (Sevilla, desde 2007; grupo Puerto Seguro). Primer cliente y piloto de la plataforma MultiBar. Aquí va todo lo que es SOLO de este bar; lo común está en el `CLAUDE.md` de la raíz.

- Enlace de la carta: `/carta/?bar=lamardegambas` (siempre con `bar=`: desde el 14 oct ya no hay bar por defecto y un enlace sin `bar=`, o con uno mal escrito, lleva a la página de MultiBar, nunca a este bar). QR de mesa: `/carta/?bar=lamardegambas&mesa=N&c=CÓDIGO` (panel → Mesas → Copiar enlace).
- Copia de reserva: `menu.json` y `bar.json` en esta carpeta. Fotos de las cartas físicas (fuente de verdad de los precios): `fotos-cartas/`.
- Usuarios de prueba: `carloswxht+admin@gmail.com` (admin; Carlos ya cambió su contraseña), `carloswxht+barra@gmail.com`, `carloswxht+camarero@gmail.com` (contraseña provisional dada por el chat). Son alias de Gmail: llegan al buzón de Carlos.
- En la base (Supabase) quedan **7 pedidos de prueba** de la Mesa 1 (11–13 oct): borrarlos cuando Carlos diga "borra los pedidos de prueba" (lleva DELETE: dárselo para pegar en el SQL Editor).
- Mesas: 1–10 de ejemplo hasta tener las reales del local.

## Aspecto y versiones (última publicada: **v11**, 14 oct = control de mesas, apagado aquí; v10 = aviso legal y privacidad; v8 — cada pestaña empieza arriba, 11 oct; v7 = bebidas; v6 = pedidos desde la mesa. **v9 = MultiBar, publicada el 12 oct, se ve igual salvo "Carta v9" y la firma de autonomIA Lab**)
- Desde la Fase 1 del panel la carta ya no es un archivo único: `carta/index.html` (estructura) + `carta/carta.css` (estilos propios) + `carta/carta.js` (funcionamiento), y usa los archivos compartidos de `comun/`. Se ve exactamente igual que la v5 (comprobado píxel a píxel a 390 px y en tablet).
- El original de un solo archivo está guardado en `archivo/versiones/carta-digital-la-mar-de-gambas-v5.html`, y en git con la etiqueta `carta-v5-estable` (ver "Panel de barra").
- El menú se lee de la **base** (`carta_menu`: precios y agotados al día). Si la base no responde en 6 s se usa la copia de reserva `datos/bares/lamardegambas/menu.json` (antes `datos/menu-datos.json`) (139 productos, 9 pestañas; comprobado el 11 oct que coincide exactamente con la base). Si se cambia un producto en el panel, la copia de reserva queda desfasada: actualizarla de vez en cuando.
- Versiones a partir de ahora (decidido con Carlos el 6 oct): ya no se saca un `carta-digital-…-vN.html`; cada versión se marca con una etiqueta de git (`carta-v6`…) y un número visible en el pie de la carta ("Carta v6" desde la Fase 5; "Carta v7" con las bebidas; "Carta v8" al empezar cada pestaña arriba).
- Fuentes Oswald y DM Sans guardadas en `comun/fuentes/` (ya no se cargan desde Google: RGPD hecho).
- Colores del local, sacados de sus cartas físicas (`fotos-cartas/`): azul marino `#14295E` (fondo oscuro `#0E1F4D`), naranja `#F08A3E`, blanco. Tipografía: Oswald para títulos y totales, DM Sans para el resto. Variables comunes en `comun/estilos.css`.
- Cabecera fija azul con "LA MAR DE GAMBAS" y "Cervecerías · Desde 2007"; pestañas con raya naranja en la activa; botón + naranja; barra inferior azul con total y botón "VER TIQUE" naranja.
- Los estilos de la carta están en `carta/carta.css`: un bloque `THEME` al final anula los estilos heredados de la carta de El Recreo (tema dorado).

- **Fase C (14 oct, carta v12):** su aspecto ya no está en el código sino en `ajustes.aspecto` (aplicado en Supabase y copiado en `bar.json`): azul marino `#14295E`/`#0E1F4D`, naranja `#F08A3E`/`#D9722A`, fondo blanco, texto `#0F1E45`, Oswald + DM Sans, nombre en letras (sin logo) e icono `icono-512.png` de esta carpeta. Se ve idéntica a la v11. Para poner el logo de la gamba: subirlo a Supabase Storage (`logos/lamardegambas.png`) y poner `logo` y `cabecera` en sus ajustes.

- **v15 (15 oct):** barra y cocina separadas (barra = Café y bebidas, Cervezas y copas y Bodega; el resto, cocina), botón «Camarero» en la carta (llamar al camarero / pedir la cuenta) y «Cuentas de mesas» en el panel. Opciones `barra_cocina`, `avisos_mesa` y `cuentas_mesa`: **encendidas el 15 oct** (también en `bar.json`). Para el día a día: una tablet en barra con «Solo barra» y otra en cocina con «Solo cocina».

## Pestañas (9)
**Café y bebidas · Cervezas y copas** · Marisco y mar · Para picar · Fritos y croquetas · Carne y arroces · Panes · Postres · Bodega.
- Las dos de bebidas van **primero** porque es lo primero que pide la gente (decisión de Carlos, 11 oct). Se añadieron con `datos/cambios/2026-10-11-bebidas.sql` (ids 106–139):
  - **Café y bebidas** (`cafe`): CAFÉS (café solo, cortado, americano, café con leche, descafeinado, carajillo, infusión o té, Cola Cao) y REFRESCOS Y AGUA (Coca-Cola, Coca-Cola Zero, Fanta naranja y limón, Sprite, Aquarius, Nestea, tónica, zumo, agua, agua con gas).
  - **Cervezas y copas** (`cervezas`): CERVEZAS (caña, tubo, jarra y tercio Cruzcampo, Cruzcampo Especial, Alhambra Reserva 1925, sin alcohol, clara con limón, tinto de verano) y COMBINADOS (gin tonic, gin tonic premium, ron con cola, whisky con cola, vodka con naranja o limón, chupito).
  - **PRECIOS PROVISIONALES** (típicos de bar de Sevilla; las cartas físicas no traen bebidas). Pendiente: que el local confirme precios, marca de cerveza y qué combinados tiene. Se cambian desde el panel (Lista de precios) sin tocar código. Cada bebida es una línea sin tamaño (no se usan Tapa/Plato ni Copa/Botella); las preferencias (marca de ginebra, tipo de leche) van en la nota.
  - Salen solas en la carta, en "Nuevo pedido" del panel y en la Lista de precios (todo lee las pestañas de la base). "Modificar pedido" no muestra la carta (solo − / + de lo ya pedido).
Dentro de las pestañas que juntan varias secciones, los nombres originales de la carta física salen como subtítulo (por ejemplo "El picoteo del puerto").

## Dudas de transcripción (confirmar con las cartas físicas)
- Carne mechá 6,50 € y Chicharrón de Cádiz 6,50 €: precio medio tapado en la foto.
- "Aliño de huevas": el borde de la foto lo cortaba.
- Presa ibérica, Secreto ibérico y Cachitos ibéricos: solo se leía el precio de plato; el de tapa estaba tachado.
- Alba Martín: la carta dice "D.O. Albariño", puesto como "albariño D.O.".
- Líneas tachadas con rotulador en la carta física: no se incluyeron.
- Mojama extra: solo plato (9,00 €/80 gr); hay un precio de tapa tachado.
- Pimentada de gambas con huevos fritos, Patatas para dipear (4,00 €) y Zamburiñas (2,50 €/ud) están como una línea cada una.

## Pendiente de este bar
- **Control de mesas:** instalado y **apagado**. Encenderlo cuando Carlos diga «enciende el control de mesas» (SQL en el `CLAUDE.md`). Desde ese momento el personal abre cada mesa en el panel → «Abrir mesas».
- **Panel como app:** probar la instalación en el Android de Carlos y en la tablet del local.
0. **Datos legales del titular** para el aviso legal y la privacidad (14 oct): razón social o nombre, NIF/CIF, domicilio, correo de contacto (y teléfono y datos registrales si es sociedad). Hasta tenerlos, la carta no enseña el enlace.
1. Generar los **QR** de las mesas reales (con el dominio `carta.autonomialab.es`, nunca github.io), cuando el local dé sus mesas.
8. Pruebas con móviles reales (`PRUEBAS-FASE-5.md`), sobre todo **iPhone/Safari** y con dos aparatos (panel y carta).
9. Confirmar con el local precios de las bebidas (provisionales), la cerveza que sirven (puesta Cruzcampo) y los combinados.
10. Antes de imprimir los QR: precios aprobados por escrito, alérgenos, aviso legal, mesas reales en el panel, copias de seguridad.
2. Vista previa de WhatsApp: quitada a petición de Carlos (12 oct); la imagen hecha está en `archivo/og-gambas5.jpg` por si vuelve.
3. Alérgenos: la carta física los lleva en un QR aparte. Desde la v30 (18 oct) existe la opción `alergenos` (apagada aquí): pedir la lista al local, marcarlos en el panel (Editar producto) y encender la opción desde `/plataforma/`. Hoy 0 de 139 productos los tienen.
4. Fotos de productos: desde la v26 la opción `fotos` (apagada aquí) pone miniatura y foto grande; se suben desde el panel. Los postres tienen foto en la carta física, pero hay que pedirlas aparte.
5. Opcional: logo de la gamba en la cabecera (usar una foto limpia que dé Carlos).
6. ~~Pedidos reales a un panel de barra~~: hecho (panel + Fase 5, ver "Panel de barra").
7. Opcional: la pestaña «★ Lo mejor» ya existe (v30, opción `mas_pedidos`, más los destacados de la v25); el buscador llega en la «carta más fácil», entrega 2. Las opciones v25, v26 y v30 siguen apagadas en este bar (18 oct).
