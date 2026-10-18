-- =====================================================================
-- DATOS INICIALES · MultiBar · bar nº 1: La Mar de Gambas
-- Generado a partir de datos/bares/lamardegambas/menu.json (precios de las cartas
-- físicas, pendientes de aprobación por escrito del local; las bebidas
-- llevan precios provisionales).
-- Ejecutar después de datos/esquema.sql.
-- =====================================================================

-- ---------------- EL BAR ----------------
-- Su nombre se escribe solo aquí (y en la copia de reserva
-- datos/bares/lamardegambas/bar.json): carta, panel y tique lo leen de la base.
-- Las tablas están en las carpetas «comun» y «multibar» (17 oct).
set search_path = multibar, comun, public;

insert into bares (id, slug, nombre, subtitulo, ajustes) overriding system value values
  (1, 'lamardegambas', 'La Mar de Gambas', 'Cervecerías · Desde 2007', jsonb_build_object(
    'pie', jsonb_build_array(
      'IVA incluido',
      'Picos 0,90€ por persona · Extra de salsa 0,50€',
      'Salsas: mojo picón, brava, BBQ, ali-oli, cheddar, whisky, crema de queso, césar o salsa verde',
      'La Mar de Gambas · Cervecerías'),
    -- Aspecto del bar (Fase C, formato en comun/aspecto.js)
    'aspecto', '{"plantilla": "clasica",
      "colores": {"principal": "#14295E", "principal_oscuro": "#0E1F4D", "acento": "#F08A3E", "acento_oscuro": "#D9722A",
                  "fondo": "#FFFFFF", "fondo_2": "#F3F6FB", "texto": "#0F1E45"},
      "fuentes": {"titulos": "oswald", "texto": "dmsans"}, "cabecera": "nombre",
      "icono": "datos/bares/lamardegambas/icono-512.png", "nombre_corto": "La Mar de Gambas"}'::jsonb));
select setval(pg_get_serial_sequence('bares','id'), (select max(id) from bares));

-- ---------------- PESTAÑAS (9) ----------------
-- Café y bebidas y Cervezas y copas van primero (añadidas el 11 oct, con
-- precios provisionales: las cartas físicas no traen bebidas).
insert into categories (bar_id, id, name, sort_order, multi, fam, labs) values
  (1, 'cafe', 'CAFÉ Y BEBIDAS', 1, true, '', '{}'),
  (1, 'cervezas', 'CERVEZAS Y COPAS', 2, true, '', '{}'),
  (1, 'mar', 'MARISCO Y MAR', 3, true, 'tp', ARRAY['Tapa','Plato']),
  (1, 'picar', 'PARA PICAR', 4, true, 'tp', ARRAY['Tapa','Plato']),
  (1, 'fritos', 'FRITOS Y CROQUETAS', 5, true, 'tp', ARRAY['Tapa','Plato']),
  (1, 'carne', 'CARNE Y ARROCES', 6, true, 'tp', ARRAY['Tapa','Plato']),
  (1, 'panes', 'PANES', 7, true, 'tp', ARRAY['Tapa','Plato']),
  (1, 'postres', 'POSTRES', 8, false, '', '{}'),
  (1, 'bodega', 'BODEGA', 9, false, 'cb', ARRAY['Copa','Botella']);

-- ---------------- PRODUCTOS (139) ----------------
-- Barra y cocina (v15): las pestañas de bebida van a la barra; el resto, a cocina.
update categories set destino = 'barra' where bar_id = 1 and id in ('cafe', 'cervezas', 'bodega');

insert into products (bar_id, id, category_id, name, display_name, description, size, only_size, section, price, featured, allergens, photo, sort_order) overriding system value values
  (1, 1, 'mar', 'Media mariscada', NULL, '550 g aprox. · gambas, patas rusas, langostinos, cigalas y mejillones', NULL, false, 'MARISCO COCIDO', 20.00, false, NULL, '', 1),
  (1, 2, 'mar', 'Gambas', NULL, '200 gr', NULL, false, 'MARISCO COCIDO', 7.50, false, NULL, '', 2),
  (1, 3, 'mar', 'Langostinos', NULL, '200 gr', NULL, false, 'MARISCO COCIDO', 7.00, false, NULL, '', 3),
  (1, 4, 'mar', 'Patas rusas', NULL, '200 gr', NULL, false, 'MARISCO COCIDO', 8.50, false, NULL, '', 4),
  (1, 5, 'mar', 'Mejillones', NULL, '10 uds', NULL, false, 'MARISCO COCIDO', 7.00, false, NULL, '', 5),
  (1, 6, 'mar', 'Cigalas', NULL, '5 uds', NULL, false, 'MARISCO COCIDO', 8.00, false, NULL, '', 6),
  (1, 7, 'mar', 'Almejas con langostinos La Mar de Gambas (Plato)', 'Almejas con langostinos La Mar de Gambas', 'Plato', 'Plato', true, 'JOYAS DE NUESTRA LONJA', 10.00, false, NULL, '', 7),
  (1, 8, 'mar', 'Pez espada a la plancha (Plato)', 'Pez espada a la plancha', 'Plato', 'Plato', true, 'JOYAS DE NUESTRA LONJA', 11.50, false, NULL, '', 8),
  (1, 9, 'mar', 'Zamburiñas a la plancha', NULL, 'por unidad', NULL, false, 'JOYAS DE NUESTRA LONJA', 2.50, false, NULL, '', 9),
  (1, 10, 'picar', 'Ensalada César (Plato)', 'Ensalada César', 'Plato', 'Plato', true, 'EL PICOTEO DEL PUERTO', 8.00, false, NULL, '', 10),
  (1, 11, 'picar', 'Salmorejo con jamón y huevo (Plato)', 'Salmorejo con jamón y huevo', 'Plato', 'Plato', true, 'EL PICOTEO DEL PUERTO', 4.50, false, NULL, '', 11),
  (1, 12, 'picar', 'Cóctel de marisco (Plato)', 'Cóctel de marisco', 'Plato', 'Plato', true, 'EL PICOTEO DEL PUERTO', 5.00, false, NULL, '', 12),
  (1, 13, 'picar', 'Abrazo de tomate con melva (Plato)', 'Abrazo de tomate con melva', 'Plato', 'Plato', true, 'EL PICOTEO DEL PUERTO', 7.50, false, NULL, '', 13),
  (1, 14, 'picar', 'Papas aliñás con melva (Tapa)', 'Papas aliñás con melva', '', 'Tapa', false, 'EL PICOTEO DEL PUERTO', 4.00, false, NULL, '', 14),
  (1, 15, 'picar', 'Papas aliñás con melva (Plato)', 'Papas aliñás con melva', '', 'Plato', false, 'EL PICOTEO DEL PUERTO', 7.00, false, NULL, '', 15),
  (1, 16, 'picar', 'Papas ali-oli (Tapa)', 'Papas ali-oli', '', 'Tapa', false, 'EL PICOTEO DEL PUERTO', 4.00, false, NULL, '', 16),
  (1, 17, 'picar', 'Papas ali-oli (Plato)', 'Papas ali-oli', '', 'Plato', false, 'EL PICOTEO DEL PUERTO', 7.00, false, NULL, '', 17),
  (1, 18, 'picar', 'Ensaladilla de marisco (Tapa)', 'Ensaladilla de marisco', '', 'Tapa', false, 'EL PICOTEO DEL PUERTO', 4.20, false, NULL, '', 18),
  (1, 19, 'picar', 'Ensaladilla de marisco (Plato)', 'Ensaladilla de marisco', '', 'Plato', false, 'EL PICOTEO DEL PUERTO', 8.00, false, NULL, '', 19),
  (1, 20, 'picar', 'Aliño de huevas (Tapa)', 'Aliño de huevas', '', 'Tapa', false, 'EL PICOTEO DEL PUERTO', 4.20, false, NULL, '', 20),
  (1, 21, 'picar', 'Aliño de huevas (Plato)', 'Aliño de huevas', '', 'Plato', false, 'EL PICOTEO DEL PUERTO', 8.00, false, NULL, '', 21),
  (1, 22, 'picar', 'Salpicón de marisco (Tapa)', 'Salpicón de marisco', '', 'Tapa', false, 'EL PICOTEO DEL PUERTO', 4.00, false, NULL, '', 22),
  (1, 23, 'picar', 'Salpicón de marisco (Plato)', 'Salpicón de marisco', '', 'Plato', false, 'EL PICOTEO DEL PUERTO', 7.50, false, NULL, '', 23),
  (1, 24, 'picar', 'Atún encebollao (Tapa)', 'Atún encebollao', '', 'Tapa', false, 'EL PICOTEO DEL PUERTO', 4.50, false, NULL, '', 24),
  (1, 25, 'picar', 'Atún encebollao (Plato)', 'Atún encebollao', '', 'Plato', false, 'EL PICOTEO DEL PUERTO', 9.00, false, NULL, '', 25),
  (1, 26, 'picar', 'Mojama extra (Plato)', 'Mojama extra', 'Plato · 80 gr', 'Plato', true, 'EL PICOTEO DEL PUERTO', 9.00, false, NULL, '', 26),
  (1, 27, 'picar', 'Jamón 50% cebo', NULL, '60 gr · con regañá de bellota', NULL, false, 'DE CUCHILLO Y TABLA', 10.00, false, NULL, '', 27),
  (1, 28, 'picar', 'Caña de lomo ibérica', NULL, '60 gr', NULL, false, 'DE CUCHILLO Y TABLA', 9.50, false, NULL, '', 28),
  (1, 29, 'picar', 'Carne mechá', NULL, '', NULL, false, 'DE CUCHILLO Y TABLA', 6.50, false, NULL, '', 29),
  (1, 30, 'picar', 'Chicharrón de Cádiz', NULL, '', NULL, false, 'DE CUCHILLO Y TABLA', 6.50, false, NULL, '', 30),
  (1, 31, 'picar', 'Queso Apolonio (Tapa)', 'Queso Apolonio', '60 gr', 'Tapa', false, 'DE CUCHILLO Y TABLA', 4.80, false, NULL, '', 31),
  (1, 32, 'picar', 'Queso Apolonio (Plato)', 'Queso Apolonio', '150 gr', 'Plato', false, 'DE CUCHILLO Y TABLA', 9.00, false, NULL, '', 32),
  (1, 33, 'picar', 'Tabla de quesos (Tapa)', 'Tabla de quesos', 'Tapa · curado, trufa y picante · 85 gr', 'Tapa', true, 'DE CUCHILLO Y TABLA', 9.00, false, NULL, '', 33),
  (1, 34, 'fritos', 'Pimentada de gambas de cristal (Plato)', 'Pimentada de gambas de cristal', 'Plato · con dos huevos fritos', 'Plato', true, 'REBOZADOS DEL PUERTO', 9.50, false, NULL, '', 34),
  (1, 35, 'fritos', 'Croquetas de caña de lomo (Tapa)', 'Croquetas de caña de lomo', '3 uds', 'Tapa', false, 'REBOZADOS DEL PUERTO', 4.20, false, NULL, '', 35),
  (1, 36, 'fritos', 'Croquetas de caña de lomo (Plato)', 'Croquetas de caña de lomo', '6 uds', 'Plato', false, 'REBOZADOS DEL PUERTO', 8.50, false, NULL, '', 36),
  (1, 37, 'fritos', 'Croquetas de gambas al ajillo (Tapa)', 'Croquetas de gambas al ajillo', '3 uds', 'Tapa', false, 'REBOZADOS DEL PUERTO', 4.20, false, NULL, '', 37),
  (1, 38, 'fritos', 'Croquetas de gambas al ajillo (Plato)', 'Croquetas de gambas al ajillo', '6 uds', 'Plato', false, 'REBOZADOS DEL PUERTO', 8.50, false, NULL, '', 38),
  (1, 39, 'fritos', 'Croquetas de puchero (Tapa)', 'Croquetas de puchero', '3 uds', 'Tapa', false, 'REBOZADOS DEL PUERTO', 4.20, false, NULL, '', 39),
  (1, 40, 'fritos', 'Croquetas de puchero (Plato)', 'Croquetas de puchero', '6 uds', 'Plato', false, 'REBOZADOS DEL PUERTO', 8.50, false, NULL, '', 40),
  (1, 41, 'fritos', 'Croquetas de rulo de cabra con cebolla caramelizada (Tapa)', 'Croquetas de rulo de cabra con cebolla caramelizada', '3 uds', 'Tapa', false, 'REBOZADOS DEL PUERTO', 4.20, false, NULL, '', 41),
  (1, 42, 'fritos', 'Croquetas de rulo de cabra con cebolla caramelizada (Plato)', 'Croquetas de rulo de cabra con cebolla caramelizada', '6 uds', 'Plato', false, 'REBOZADOS DEL PUERTO', 8.50, false, NULL, '', 42),
  (1, 43, 'fritos', 'Surtido de croquetas (Plato)', 'Surtido de croquetas', 'Plato · 8 uds', 'Plato', true, 'REBOZADOS DEL PUERTO', 10.00, false, NULL, '', 43),
  (1, 44, 'fritos', 'Finger de pollo cajún crujiente (Tapa)', 'Finger de pollo cajún crujiente', 'salsa a elegir', 'Tapa', false, 'REBOZADOS DEL PUERTO', 5.00, false, NULL, '', 44),
  (1, 45, 'fritos', 'Finger de pollo cajún crujiente (Plato)', 'Finger de pollo cajún crujiente', 'salsa a elegir', 'Plato', false, 'REBOZADOS DEL PUERTO', 8.50, false, NULL, '', 45),
  (1, 46, 'fritos', 'Adobo frito (Tapa)', 'Adobo frito', '', 'Tapa', false, 'EL ARTE DEL FRITO ANDALUZ', 4.00, false, NULL, '', 46),
  (1, 47, 'fritos', 'Adobo frito (Plato)', 'Adobo frito', '', 'Plato', false, 'EL ARTE DEL FRITO ANDALUZ', 7.50, false, NULL, '', 47),
  (1, 48, 'fritos', 'Chocos fritos (Tapa)', 'Chocos fritos', '', 'Tapa', false, 'EL ARTE DEL FRITO ANDALUZ', 5.00, false, NULL, '', 48),
  (1, 49, 'fritos', 'Chocos fritos (Plato)', 'Chocos fritos', '', 'Plato', false, 'EL ARTE DEL FRITO ANDALUZ', 9.50, false, NULL, '', 49),
  (1, 50, 'fritos', 'Boquerones fritos (Tapa)', 'Boquerones fritos', '', 'Tapa', false, 'EL ARTE DEL FRITO ANDALUZ', 4.20, false, NULL, '', 50),
  (1, 51, 'fritos', 'Boquerones fritos (Plato)', 'Boquerones fritos', '', 'Plato', false, 'EL ARTE DEL FRITO ANDALUZ', 8.00, false, NULL, '', 51),
  (1, 52, 'fritos', 'Tortillita de camarones', NULL, 'por unidad', NULL, false, 'EL ARTE DEL FRITO ANDALUZ', 2.00, false, NULL, '', 52),
  (1, 53, 'carne', 'Pinchito de pollo (Tapa)', 'Pinchito de pollo', 'Tapa', 'Tapa', true, 'BOCADOS DE LA DEHESA', 4.20, false, NULL, '', 53),
  (1, 54, 'carne', 'Presa ibérica (Plato)', 'Presa ibérica', 'Plato', 'Plato', true, 'BOCADOS DE LA DEHESA', 10.50, false, NULL, '', 54),
  (1, 55, 'carne', 'Secreto ibérico (Plato)', 'Secreto ibérico', 'Plato', 'Plato', true, 'BOCADOS DE LA DEHESA', 9.50, false, NULL, '', 55),
  (1, 56, 'carne', 'Cachitos ibéricos (Plato)', 'Cachitos ibéricos', 'Plato · salsa mojo picón', 'Plato', true, 'BOCADOS DE LA DEHESA', 8.50, false, NULL, '', 56),
  (1, 57, 'carne', 'Solomillo de cerdo (Tapa)', 'Solomillo de cerdo', 'salsa a elegir', 'Tapa', false, 'BOCADOS DE LA DEHESA', 4.00, false, NULL, '', 57),
  (1, 58, 'carne', 'Solomillo de cerdo (Plato)', 'Solomillo de cerdo', 'salsa a elegir', 'Plato', false, 'BOCADOS DE LA DEHESA', 7.50, false, NULL, '', 58),
  (1, 59, 'carne', 'Arroz mixto (Tapa)', 'Arroz mixto', 'pollo, marisco y verduras', 'Tapa', false, 'LA ARROCERÍA', 4.50, false, NULL, '', 59),
  (1, 60, 'carne', 'Arroz mixto (Plato)', 'Arroz mixto', 'pollo, marisco y verduras', 'Plato', false, 'LA ARROCERÍA', 8.50, false, NULL, '', 60),
  (1, 61, 'carne', 'Arroz negro (Tapa)', 'Arroz negro', 'chipirones, gambas y ali-oli', 'Tapa', false, 'LA ARROCERÍA', 4.50, false, NULL, '', 61),
  (1, 62, 'carne', 'Arroz negro (Plato)', 'Arroz negro', 'chipirones, gambas y ali-oli', 'Plato', false, 'LA ARROCERÍA', 8.50, false, NULL, '', 62),
  (1, 63, 'carne', 'Arroz del señorito (Tapa)', 'Arroz del señorito', 'gambas, calamares y pescado', 'Tapa', false, 'LA ARROCERÍA', 4.50, false, NULL, '', 63),
  (1, 64, 'carne', 'Arroz del señorito (Plato)', 'Arroz del señorito', 'gambas, calamares y pescado', 'Plato', false, 'LA ARROCERÍA', 8.50, false, NULL, '', 64),
  (1, 65, 'carne', 'Patatas para dipear', NULL, 'elige tu salsa', NULL, false, 'LA ARROCERÍA', 4.00, false, NULL, '', 65),
  (1, 66, 'panes', 'Pan con chicharrón de Cádiz y mojo picón (Plato)', 'Pan con chicharrón de Cádiz y mojo picón', 'Plato', 'Plato', true, 'REBANADA DE PUEBLO', 8.50, false, NULL, '', 66),
  (1, 67, 'panes', 'Pan con salmorejo y mojama (Plato)', 'Pan con salmorejo y mojama', 'Plato', 'Plato', true, 'REBANADA DE PUEBLO', 10.00, false, NULL, '', 67),
  (1, 68, 'panes', 'Pan con salmorejo y jamón (Plato)', 'Pan con salmorejo y jamón', 'Plato', 'Plato', true, 'REBANADA DE PUEBLO', 10.00, false, NULL, '', 68),
  (1, 69, 'panes', 'Pan con carne mechá y mojo picón (Plato)', 'Pan con carne mechá y mojo picón', 'Plato', 'Plato', true, 'REBANADA DE PUEBLO', 8.50, false, NULL, '', 69),
  (1, 70, 'panes', 'Serranito de pollo o lomo', NULL, 'jamón, pimiento frito y tomate', NULL, false, 'BOCATITAS EN PAN DE CRISTAL', 6.00, false, NULL, '', 70),
  (1, 71, 'panes', 'Piripi', NULL, 'lomo adobado, beicon, queso semicurado y ali-oli', NULL, false, 'BOCATITAS EN PAN DE CRISTAL', 5.50, false, NULL, '', 71),
  (1, 72, 'panes', 'Pollo empanado', NULL, 'con lechuga y mayonesa', NULL, false, 'BOCATITAS EN PAN DE CRISTAL', 6.00, false, NULL, '', 72),
  (1, 73, 'panes', 'Mantecaíto La Mar de Gambas', NULL, 'langostino, ali-oli y patatas fritas', NULL, false, 'BOCATITAS EN PAN DE CRISTAL', 5.50, false, NULL, '', 73),
  (1, 74, 'panes', 'El Puerto', NULL, 'calamares fritos y ali-oli', NULL, false, 'BOCATITAS EN PAN DE CRISTAL', 5.50, false, NULL, '', 74),
  (1, 75, 'panes', 'Filete de lomo con mojo picón', NULL, '', NULL, false, 'MONTADITOS', 4.00, false, NULL, '', 75),
  (1, 76, 'panes', 'Filete de pollo con ali-oli', NULL, '', NULL, false, 'MONTADITOS', 4.00, false, NULL, '', 76),
  (1, 77, 'panes', 'Melva con pimientos del piquillo y mayonesa', NULL, '', NULL, false, 'MONTADITOS', 4.00, false, NULL, '', 77),
  (1, 78, 'panes', 'Lomo con crema de queso y cebolla caramelizada', NULL, '', NULL, false, 'MONTADITOS', 4.00, false, NULL, '', 78),
  (1, 79, 'panes', 'Chorizo picante con crema de queso', NULL, '', NULL, false, 'MONTADITOS', 4.00, false, NULL, '', 79),
  (1, 80, 'panes', 'Pringá casera', NULL, '', NULL, false, 'MONTADITOS', 4.00, false, NULL, '', 80),
  (1, 81, 'postres', 'Perfecto de turrón', NULL, 'helado caliente con gelatina de turrón y crocanti de almendra', NULL, false, 'EL MEJOR FINAL', 4.95, false, NULL, '', 81),
  (1, 82, 'postres', 'Tocino de cielo, nata y nueces', NULL, '', NULL, false, 'EL MEJOR FINAL', 4.95, false, NULL, '', 82),
  (1, 83, 'postres', 'Ricotta y frutas del bosque', NULL, '', NULL, false, 'EL MEJOR FINAL', 4.95, false, NULL, '', 83),
  (1, 84, 'postres', 'Chocolate tres texturas', NULL, '', NULL, false, 'EL MEJOR FINAL', 4.95, false, NULL, '', 84),
  (1, 85, 'postres', 'Arroz con leche', NULL, 'nuevo · por unidad', NULL, false, 'EL MEJOR FINAL', 3.50, false, NULL, '', 85),
  (1, 86, 'postres', 'Tocino de cielo', NULL, 'nuevo · por unidad', NULL, false, 'EL MEJOR FINAL', 4.00, false, NULL, '', 86),
  (1, 87, 'bodega', 'Añares Crianza (Copa)', 'Añares Crianza', 'tinto D.O. Rioja', 'Copa', false, 'LA BODEGA', 2.60, false, NULL, '', 87),
  (1, 88, 'bodega', 'Añares Crianza (Botella)', 'Añares Crianza', 'tinto D.O. Rioja', 'Botella', false, 'LA BODEGA', 13.50, false, NULL, '', 88),
  (1, 89, 'bodega', 'Protos Roble (Copa)', 'Protos Roble', 'tinto D.O. Ribera del Duero', 'Copa', false, 'LA BODEGA', 3.70, false, NULL, '', 89),
  (1, 90, 'bodega', 'Protos Roble (Botella)', 'Protos Roble', 'tinto D.O. Ribera del Duero', 'Botella', false, 'LA BODEGA', 17.50, false, NULL, '', 90),
  (1, 91, 'bodega', 'Maestrante (Copa)', 'Maestrante', 'blanco semidulce', 'Copa', false, 'LA BODEGA', 2.70, false, NULL, '', 91),
  (1, 92, 'bodega', 'Maestrante (Botella)', 'Maestrante', 'blanco semidulce', 'Botella', false, 'LA BODEGA', 13.00, false, NULL, '', 92),
  (1, 93, 'bodega', 'Castillo de San Diego (Copa)', 'Castillo de San Diego', 'blanco semiseco', 'Copa', false, 'LA BODEGA', 2.70, false, NULL, '', 93),
  (1, 94, 'bodega', 'Castillo de San Diego (Botella)', 'Castillo de San Diego', 'blanco semiseco', 'Botella', false, 'LA BODEGA', 13.00, false, NULL, '', 94),
  (1, 95, 'bodega', 'Alberto Sanz (Copa)', 'Alberto Sanz', 'blanco D.O. Rueda', 'Copa', false, 'LA BODEGA', 2.30, false, NULL, '', 95),
  (1, 96, 'bodega', 'Alberto Sanz (Botella)', 'Alberto Sanz', 'blanco D.O. Rueda', 'Botella', false, 'LA BODEGA', 11.00, false, NULL, '', 96),
  (1, 97, 'bodega', 'Barbadillo VI (Copa)', 'Barbadillo VI', 'frizzante', 'Copa', false, 'LA BODEGA', 3.10, false, NULL, '', 97),
  (1, 98, 'bodega', 'Barbadillo VI (Botella)', 'Barbadillo VI', 'frizzante', 'Botella', false, 'LA BODEGA', 15.00, false, NULL, '', 98),
  (1, 99, 'bodega', 'Alba Martín (Copa)', 'Alba Martín', 'albariño D.O.', 'Copa', false, 'LA BODEGA', 3.70, false, NULL, '', 99),
  (1, 100, 'bodega', 'Alba Martín (Botella)', 'Alba Martín', 'albariño D.O.', 'Botella', false, 'LA BODEGA', 18.00, false, NULL, '', 100),
  (1, 101, 'bodega', 'Heredad Hidalgo Oloroso (Copa)', 'Heredad Hidalgo Oloroso', 'Copa · generoso', 'Copa', true, 'LA BODEGA', 2.10, false, NULL, '', 101),
  (1, 102, 'bodega', 'Sol Málaga (Copa)', 'Sol Málaga', 'Copa · vino dulce', 'Copa', true, 'LA BODEGA', 2.30, false, NULL, '', 102),
  (1, 103, 'bodega', 'La Gabriela (Copa)', 'La Gabriela', 'manzanilla', 'Copa', false, 'LA BODEGA', 2.70, false, NULL, '', 103),
  (1, 104, 'bodega', 'La Gabriela (Botella)', 'La Gabriela', 'manzanilla', 'Botella', false, 'LA BODEGA', 16.00, false, NULL, '', 104),
  (1, 105, 'bodega', 'Izaguirre Rojo (Copa)', 'Izaguirre Rojo', 'Copa · vermouth', 'Copa', true, 'LA BODEGA', 3.80, false, NULL, '', 105);

-- Bebidas (añadidas el 11 oct, ver datos/cambios/2026-10-11-bebidas.sql). PRECIOS PROVISIONALES.
insert into products (bar_id, id, category_id, name, display_name, description, size, only_size, section, price, featured, allergens, photo, sort_order) overriding system value values
  (1, 106, 'cafe', 'Café solo', NULL, '', NULL, false, 'CAFÉS', 1.30, false, NULL, '', 106),
  (1, 107, 'cafe', 'Cortado', NULL, '', NULL, false, 'CAFÉS', 1.40, false, NULL, '', 107),
  (1, 108, 'cafe', 'Americano', NULL, '', NULL, false, 'CAFÉS', 1.40, false, NULL, '', 108),
  (1, 109, 'cafe', 'Café con leche', NULL, '', NULL, false, 'CAFÉS', 1.60, false, NULL, '', 109),
  (1, 110, 'cafe', 'Descafeinado', NULL, 'de máquina o de sobre', NULL, false, 'CAFÉS', 1.60, false, NULL, '', 110),
  (1, 111, 'cafe', 'Carajillo', NULL, '', NULL, false, 'CAFÉS', 2.00, false, NULL, '', 111),
  (1, 112, 'cafe', 'Infusión o té', NULL, 'manzanilla, poleo, menta o té', NULL, false, 'CAFÉS', 1.50, false, NULL, '', 112),
  (1, 113, 'cafe', 'Cola Cao', NULL, '', NULL, false, 'CAFÉS', 1.80, false, NULL, '', 113),
  (1, 114, 'cafe', 'Coca-Cola', NULL, '', NULL, false, 'REFRESCOS Y AGUA', 2.30, false, NULL, '', 114),
  (1, 115, 'cafe', 'Coca-Cola Zero', NULL, '', NULL, false, 'REFRESCOS Y AGUA', 2.30, false, NULL, '', 115),
  (1, 116, 'cafe', 'Fanta naranja', NULL, '', NULL, false, 'REFRESCOS Y AGUA', 2.30, false, NULL, '', 116),
  (1, 117, 'cafe', 'Fanta limón', NULL, '', NULL, false, 'REFRESCOS Y AGUA', 2.30, false, NULL, '', 117),
  (1, 118, 'cafe', 'Sprite', NULL, '', NULL, false, 'REFRESCOS Y AGUA', 2.30, false, NULL, '', 118),
  (1, 119, 'cafe', 'Aquarius', NULL, 'limón o naranja', NULL, false, 'REFRESCOS Y AGUA', 2.40, false, NULL, '', 119),
  (1, 120, 'cafe', 'Nestea', NULL, '', NULL, false, 'REFRESCOS Y AGUA', 2.40, false, NULL, '', 120),
  (1, 121, 'cafe', 'Tónica', NULL, '', NULL, false, 'REFRESCOS Y AGUA', 2.30, false, NULL, '', 121),
  (1, 122, 'cafe', 'Zumo', NULL, 'naranja, piña o melocotón', NULL, false, 'REFRESCOS Y AGUA', 2.30, false, NULL, '', 122),
  (1, 123, 'cafe', 'Agua', NULL, '50 cl', NULL, false, 'REFRESCOS Y AGUA', 1.50, false, NULL, '', 123),
  (1, 124, 'cafe', 'Agua con gas', NULL, '', NULL, false, 'REFRESCOS Y AGUA', 1.80, false, NULL, '', 124),
  (1, 125, 'cervezas', 'Caña Cruzcampo', NULL, '', NULL, false, 'CERVEZAS', 1.80, false, NULL, '', 125),
  (1, 126, 'cervezas', 'Tubo Cruzcampo', NULL, '', NULL, false, 'CERVEZAS', 2.20, false, NULL, '', 126),
  (1, 127, 'cervezas', 'Jarra Cruzcampo', NULL, '', NULL, false, 'CERVEZAS', 3.00, false, NULL, '', 127),
  (1, 128, 'cervezas', 'Tercio Cruzcampo', NULL, '', NULL, false, 'CERVEZAS', 2.50, false, NULL, '', 128),
  (1, 129, 'cervezas', 'Cruzcampo Especial', NULL, 'tercio', NULL, false, 'CERVEZAS', 2.80, false, NULL, '', 129),
  (1, 130, 'cervezas', 'Alhambra Reserva 1925', NULL, 'tercio', NULL, false, 'CERVEZAS', 3.20, false, NULL, '', 130),
  (1, 131, 'cervezas', 'Cerveza sin alcohol', NULL, 'tercio', NULL, false, 'CERVEZAS', 2.50, false, NULL, '', 131),
  (1, 132, 'cervezas', 'Clara con limón', NULL, 'caña', NULL, false, 'CERVEZAS', 2.00, false, NULL, '', 132),
  (1, 133, 'cervezas', 'Tinto de verano', NULL, '', NULL, false, 'CERVEZAS', 2.50, false, NULL, '', 133),
  (1, 134, 'cervezas', 'Gin tonic', NULL, '', NULL, false, 'COMBINADOS', 7.00, false, NULL, '', 134),
  (1, 135, 'cervezas', 'Gin tonic premium', NULL, 'ginebra premium a elegir', NULL, false, 'COMBINADOS', 9.00, false, NULL, '', 135),
  (1, 136, 'cervezas', 'Ron con cola', NULL, '', NULL, false, 'COMBINADOS', 6.50, false, NULL, '', 136),
  (1, 137, 'cervezas', 'Whisky con cola', NULL, '', NULL, false, 'COMBINADOS', 6.50, false, NULL, '', 137),
  (1, 138, 'cervezas', 'Vodka con naranja o limón', NULL, '', NULL, false, 'COMBINADOS', 6.50, false, NULL, '', 138),
  (1, 139, 'cervezas', 'Chupito', NULL, 'orujo, pacharán o licor de hierbas', NULL, false, 'COMBINADOS', 2.50, false, NULL, '', 139);
-- Los productos nuevos que cree el admin seguirán a partir del 140.
select setval(pg_get_serial_sequence('products','id'), (select max(id) from products));

-- ---------------- MESAS DE EJEMPLO (1 a 10) ----------------
-- Hipotéticas hasta tener las reales del local. El código secreto de
-- cada QR lo genera la base al crear la mesa (no está en este archivo).
insert into mesas (bar_id, id, name)
select 1, n, 'Mesa ' || n from generate_series(1, 10) as n;
