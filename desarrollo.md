# Registro de Desarrollo - Calculadora de Autopartes

## 📅 Estado Actual: 06 de Noviembre, 2026 (Séptima Etapa: Incorporación de Columna id_pieza en Cotizaciones_acidentalidad)

### ✅ Hitos Completados
1. **Modelo y Persistencia Relacional (`models.py` y Migración 0002)**:
   - Se incorporó formalmente el campo **`id_pieza`** (`CharField(max_length=250, null=True, blank=True, db_index=True, verbose_name="ID de la Pieza")`) en el modelo `CotizacionAccidentalidad` (tabla física `Cotizaciones_acidentalidad` en MySQL).
   - Se generó el archivo de migración oficial de Django: `apps/calculator/migrations/0002_cotizacionaccidentalidad_id_pieza.py`.
   - Se implementó la rutina de aseguramiento de esquema DDL automático `asegurar_columna_id_pieza()` en `views.py` para verificar la existencia física de la columna e índice en MySQL y registrar la migración en `django_migrations`.
2. **Panel de Administración de Django (`admin.py`)**:
   - Se integró `id_pieza` en `list_display` y `search_fields` de `CotizacionAccidentalidadAdmin`, permitiendo auditar y filtrar cotizaciones directamente por código o referencia de repuesto.
3. **Controladores y Captura de Datos (`views.py`)**:
   - En `guardar_cotizacion`: se recibe `id_pieza` del formulario POST; en caso de ausencia, cuenta con un fallback de extracción inteligente desde el payload estructurado `piezas_json`. Se almacena tanto en cotizaciones nuevas como en actualizaciones de cotizaciones existentes.
   - En `index`: se transmite `id_pieza` en el diccionario `cotizacion_editar` para modo edición.
   - En `lista_cotizaciones`: se serializa `id_pieza` dentro de la lista de cotizaciones activas para consumo en tarjetas HTML.
4. **Sincronización Reactiva en Frontend (`index.html` y `app.js`)**:
   - En `index.html`: se incorporó el input oculto `<input type="hidden" name="id_pieza" id="formIdPieza" />` dentro de `formGuardarCotizacion`.
   - En `app.js` (`renderCart`): se sincroniza reactivamente `#formIdPieza` con las referencias únicas de las piezas agregadas al carrito (ej. `RCEX0174, NCEX0021`). Se limpia automáticamente al vaciar el carrito y se restaura al editar una cotización.
5. **Visualización y Búsqueda Dinámica en Historial (`lista_cotizaciones.html`)**:
   - Cada tarjeta (`.quote-card`) incluye el atributo `data-id-pieza="{{ cotizacion.id_pieza }}"`.
   - Se muestra un badge visual con la referencia: `🔧 Ref: {{ cotizacion.id_pieza }}` en la fila de datos del móvil.
   - Se actualizó el motor de búsqueda en tiempo real `filterCards()` para que el usuario pueda filtrar al instante por código o referencia de pieza.

---

## 📅 Hitos Previos: 28 de Octubre, 2026 (Sexta Etapa: Nueva Liquidación Financiera SAO6 - AI 35%, Subtotal y Opción 4 en PDF)

### ✅ Hitos Completados
1. **Nueva Lógica de Negocio Financiera (`pdfGenerator.js`)**:
   - **Administración e Imprevistos (AI)**: Se incorporó la constante `FACTOR_AI = 0.35` (35% del subtotal).
   - **Mano de Obra (MO)**: Se ratificó `FACTOR_MANO_DE_OBRA = 0.30` (30% del subtotal).
   - **Fórmula Formal de Liquidación**: Se implementó la regla solicitada:
     $$\text{Total Final} = \text{Subtotal} + \text{AI (35\%)} + \text{Mano de obra (30\%)} = \text{Subtotal} \times 1.65$$
   - Se preservó retrocompatibilidad para integraciones previas mediante el alias `recargoSubtotal: ai`.
2. **Implementación de la Opción 4 en el Resumen Financiero del PDF**:
   - Se ajustó el bloque desglosado para posicionar **`Subtotal`** de primero, inmediatamente por encima de **`Costo total repuesto`**.
   - Orden jerárquico final renderizado en la tarjeta del PDF:
     1. `Subtotal:` Valor base de repuestos cotizados.
     2. `Costo total repuesto:` Suma del valor unitario de piezas.
     3. `AI (35%):` 35% del subtotal.
     4. `Mano de obra (30%):` 30% del subtotal.
     5. `Piezas cotizadas:` Cantidad total de piezas (`X und`).
     6. `TOTAL:` Banner institucional verde esmeralda con el Total Final liquidado.
   - Se incrementó la altura de la caja vectorial de 46mm a 52mm y el umbral de salto de página a 62mm para un espaciado armónico sin desbordes.
3. **Auditoría Dual y Valor Total Liquidado en Cards (`lista_cotizaciones.html` y `views.py`)**:
   - **Trazabilidad Completa de Usuarios**: La tarjeta ahora muestra de forma explícita el usuario creador (`👤 Creado por: [Nombre] el [fecha/hora]`), resolviendo automáticamente el nombre completo del colaborador a través de `PerfilUsuario` (`select_related('usuario_creador__perfil')`), y preservando debajo al usuario editor (`✍️ Modificado por: [Nombre] el [fecha/hora]`).
   - **Exhibición del Valor Total Real**: En la caja destacada (`VALOR TOTAL LIQUIDADO`), se presenta el valor final liquidado con la regla de negocio ($\text{Subtotal} \times 1.65$).
   - **Desglose Secundario**: Debajo del valor total, se exhibe el `Subtotal repuestos: $ X.XXX.XXX COP` y el valor base original si fue editada.
   - **Indicador Rápido (KPI)**: Se actualizó la tarjeta de métricas institucionales de `+15% Sub | +30% MO` a `+35% AI | +30% MO` en concordancia con la directriz financiera SAO6.
   - **Limpieza Visual del Encabezado (`lista_cotizaciones.html`)**: Se removió el emoji (`📑`) y el subtítulo del encabezado, conservando limpiamente `Historial de Cotizaciones`, y se eliminó el banner de permisos (`permission-alert`) para una interfaz minimalista y despejada.
4. **Sincronización en Visores y Control de Caché**:
   - En `apps/calculator/templates/calculator/lista_cotizaciones.html`: se actualizó `getQuoteParts` para inyectar directamente el subtotal base hacia `pdfGenerator.js`, logrando paridad milimétrica entre la tarjeta y el reporte descargable.
   - Se actualizó el parámetro de caché a `?v=20261028_4` en los scripts modulares.
5. **Consulta Escalonada de Referencias con Prioridad Excel (`Referencias.xlsx`)**:
   - **Servicio Dedicado (`reference_service.py`)**: Implementación de `lookup_part_in_excel` y `get_all_excel_references` con doble parser (`openpyxl` y fallback en `zipfile` + `xml.etree`) y caché en memoria para respuestas en 0 ms.
   - **Mapeo de Columnas**: Extracción precisa de `Referencia` (Columna A), `Desc. item` (Columna C) y `costo` (Columna E).
   - **Prioridad en Endpoint (`views.get_part_price`)**: Antes de consultar a SQL Server UNOEE, el endpoint busca la referencia en el Excel; si existe, entrega inmediatamente precio y descripción marcando `fuente: 'EXCEL'`. Si no existe, realiza el fallback transparente a la base de datos de almacén.

---

## 📅 Hitos Previos: 27 de Octubre, 2026 (Quinta Etapa: Resalte de Piezas en Edición y Persistencia en LocalStorage)

### ✅ Hitos Completados
1. **Persistencia Temporal y Borrador en `localStorage`**:
   - Se implementó la sincronización reactiva en `app.js` (`saveDraftToStorage` / `restoreSavedDraft`) bajo las claves `sao6_calc_draft_parts`, `sao6_calc_draft_bus`, `sao6_calc_draft_vehicle` y `sao6_calc_draft_view`.
   - Si el usuario refresca o cierra el navegador accidentalmente mientras arma una cotización nueva, se reconstituyen automáticamente las piezas, el bus y la perspectiva.
   - **Ciclo de Limpieza Automática**: Al momento de enviar y guardar la cotización (`submit` de `formGuardarCotizacion`), o al deseleccionar las piezas, se eliminan por completo las claves del `localStorage` (`clearDraftStorage`). Se removió el botón "Limpiar selección" a solicitud para mantener un encabezado minimalista y limpio.
2. **Resaltado Visual Preciso de Piezas en Modo Edición**:
   - **Preservación Estructurada de Geometrías**: Se optimizó `guardar_cotizacion` y `index` en `views.py` para almacenar tanto el resumen legible como el mapa JSON (`piezas_detalle`), capturando el `globalId`, `baseId`, `uniqueId`, `viewName` y `vehicleType` de cada pieza.
   - **Enfoque Automático de Perspectiva**: Al editar una cotización, la calculadora identifica la vista en la que se encuentran las partes y conmutará automáticamente a esa perspectiva SVG (ej. `Frontal`, `Izquierdo`).
   - **Motor de Emparejamiento Multi-Nivel**: En `initSVGInteractivity`, se implementó una evaluación jerárquica (globalId exacto $\rightarrow$ baseId / uniqueId $\rightarrow$ coincidencias difusas por nombre) que inyecta la clase `.selected` en todas las geometrías de la cotización existente.
   - **Estética de Resalte Superior**: Se incorporó un efecto visual con verde esmeralda brillante (`#00c851`), trazo reforzado de `4.5px` y resplandor `drop-shadow(0 0 8px rgba(0, 200, 81, 0.85))` para que las piezas seleccionadas destaquen de inmediato sobre el vehículo.

3. **Depuración y Ajuste del Formato de PDF (`pdfGenerator.js`)**:
   - **Remoción de Campos No Requeridos**: Se eliminaron del encabezado institucional las etiquetas `Tramitado por: ...`, `Validez: 15 días calendario` y `Documento Oficial de Liquidación`.
   - **Metadatos Vehiculares**: Se eliminó la columna `TRAMITADO POR` de la tarjeta superior, redistribuyendo de manera equilibrada `LÍNEA / MODELO VEHÍCULO` (izquierda) y `DIVISA BASE` (derecha).
   - **Eliminación del Cuadro de Observaciones y Criterios Aseguradora**: Se removió por completo la caja inferior izquierda que contenía el badge de severidad (`Leve`/`Severo`) y los textos normativos de aseguradoras / 2 SMMLV.
   - **Alineación Estética de Totales**: El bloque financiero de liquidación (Costo repuestos, subtotal 15%, mano de obra 30%, piezas cotizadas y total) se posicionó como tarjeta limpia y alineada al margen derecho. Se removió además la mención al responsable en el pie de página.
   - **Renombrado de Identificador Vehicular**: Se actualizó la nomenclatura del número de vehículo en la ficha de metadatos del PDF, cambiando el formato `"Bus: [número]"` por `"Unidad: [número]"` (ej: `Runner | Unidad: 150`).

4. **Diseño e Implementación del Portal de Autenticación (`login.html` / `views.py`)**:
   - **Mecanismo de Acceso Corporativo**: Autenticación basada en la combinación de `correo` institucional y `cedula` (documento de identidad) mapeados al modelo `PerfilUsuario` (tabla `Usuarios` en MySQL) y vinculados transparentemente a `auth.User`.
   - **Registro Automático de Auditoría**: Al autenticarse, el controlador y la señal `user_logged_in` actualizan el timestamp `hora_inicio_sesion` en tiempo real.
   - **Auditoría de Edición Dinámica**: Al modificar cotizaciones, se asocia el nombre real del colaborador autenticado (`usuario_obj.perfil.nombre`) y se actualiza `hora_edicion_cotizacion`.
   - **Interfaz Visual de Alto Impacto (`login.html`)**: Diseño split-card moderno con estética glassmorphic, panel institucional con el verde corporativo de SAO6 (`#00c851` a `#007a32`), textos de alto contraste blanco y menta (`#dcfce7`), inputs estilizados con iconos vectoriales (Correo y Cédula), mensajes de alerta contextuales y compatibilidad 100% responsiva.
   - **Integración en Barra de Navegación (`base.html`)**: Indicador de usuario con avatar y nombre completo junto al botón de cierre de sesión (`Salir`), o botón de acceso corporativo (`Acceder`) cuando no hay sesión activa.

---

## 📅 Hitos Previos: 22 de Octubre, 2026 (Cuarta Etapa: Persistencia Relacional MySQL y Modelo de Usuarios)

### ✅ Hitos Completados
1. **Configuración Multi-Base de Datos en `settings.py`**:
   - `default`: Conexión de lectura/escritura a **MySQL** (`bdsaocomco_cotizacion_accidentes` en `192.168.90.32:3306`) con el usuario `desarrollo`. Aquí residen las tablas de la aplicación y autenticación (`auth_user`, `Usuarios`, `Cotizaciones_acidentalidad`).
   - `unoee`: Conexión de solo lectura a **Microsoft SQL Server** (`UNOEE` en `192.168.90.64:1433`) con el usuario `power-bi` para consultar la tabla `SalidaAlmacen` (`ADMIN-SALIDAS_ALMACEN_1`).
   - Gestor `UnoeeManager` asignado a `SalidaAlmacen` para que sus consultas continúen dirigiéndose de forma transparente a SQL Server.
2. **Modelo de Cotizaciones en MySQL (`CotizacionAccidentalidad`)**:
   - Mapeo directo a la tabla física `Cotizaciones_acidentalidad`.
   - Adopción de la **Opción A** con `usuario_creador = ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)` para integridad referencial corporativa.
   - Uso de `TextField` para piezas y `DecimalField(14, 2)` para evitar distorsiones de redondeo en pesos COP.
3. **Modelo de Usuarios Extendido (`PerfilUsuario` $\rightarrow$ Tabla `Usuarios`)**:
   - Conexión 1 a 1 (`OneToOneField`) hacia `auth.User`.
   - Campos incorporados: `id` (autoincremental), `nombre` (`VARCHAR(250)`), `cedula` (`VARCHAR(50)` única e indexada), `correo` (`VARCHAR(254)` único), `hora_inicio_sesion` (`DATETIME` nullable) y `hora_edicion_cotizacion` (`DATETIME` nullable).
   - Señal automática `user_logged_in` que actualiza `hora_inicio_sesion` en cada login de usuario.
   - Actualización automática de `hora_edicion_cotizacion` al guardar cambios en una cotización existente.
   - Registro en `admin.py` con integración inline dentro del panel de administración de Django (`UserAdmin`).
4. **Migración Inicial Ejecutada con Éxito (`0001_initial.py`)**:
   - Se ejecutó `python manage.py migrate` aplicando con éxito el 100% de las operaciones DDL en `bdsaocomco_cotizacion_accidentes` (tablas `Cotizaciones_acidentalidad`, `Usuarios`, `auth_user`, `django_session`, etc.).
5. **Parche de Compatibilidad para MariaDB 10.5.x (`core/__init__.py` y `manage.py`)**:
   - Django 6.x exige por defecto MariaDB 10.6+. Como el servidor corporativo ejecuta **MariaDB 10.5.27**, se aplicó el bypass de verificación de versión (`DatabaseWrapper.check_database_version_supported = lambda self: None`, `BaseDatabaseWrapper` y `minimum_database_version = (10, 4)`) permitiendo la ejecución fluida de migraciones y operaciones DDL en el servidor sin requerir actualizar el motor de base de datos.
6. **Transición Definitiva de Sesiones a Persistencia MySQL en Vistas (`views.py`)**:
   - Se migró `guardar_cotizacion` para crear y editar registros directamente con el ORM en `CotizacionAccidentalidad`, actualizando además la `hora_edicion_cotizacion` en la tabla `Usuarios` (`PerfilUsuario`).
   - Se actualizó `index` para consultar por llave primaria la cotización a editar desde MySQL y reconstituir el estado del carrito interactivo.
   - Se actualizó `lista_cotizaciones` para consultar con `select_related('usuario_creador')` de MySQL, formateando automáticamente fechas con zona horaria de Colombia (`America/Bogota`).
   - Se implementó el endpoint `eliminar_cotizacion` (`POST /cotizaciones/<id>/eliminar/`) sincronizado con AJAX y CSRF para remover física y permanentemente cotizaciones de la base de datos MySQL.
   - Se añadió inicialización automática de cotizaciones semilla históricas (1001, 1002, 1003) si la tabla en MySQL está vacía, asegurando continuidad operativa.

---

## 📅 Hitos Previos: 20 de Octubre, 2026 (Tercera Etapa: Auditoría de Edición, Visor PDF Unificado y Descarga Directa)

### ✅ Hitos Completados
1. **Línea de Auditoría Condicional en Tarjetas (`lista_cotizaciones.html`)**:
   - Implementación de la etiqueta condicional de Django `{% if cotizacion.usuario_editor %}` en la zona superior de cada tarjeta (justo bajo la fila de flota y fecha de creación).
   - Estilizado con tipografía reducida (`0.75rem`), cursiva y tono gris tenue (`var(--color-texto-grey)`): `"✍️ Modificado por: {{ cotizacion.usuario_editor }} el {{ cotizacion.timestamp_editor }}"`.
   - Se presenta exclusivamente en las tarjetas editadas (como `COT-1008` y `COT-1009`), manteniendo una interfaz limpia en registros no modificados (como `COT-1007`).
2. **Integración del Visor Modal de PDF Idéntico a la Calculadora (`#pdfPreviewModal`)**:
   - Se reemplazó el modal antiguo de texto plano por el visor corporativo idéntico al de `index.html`.
   - Encabezado con título `📄 Vista Previa`, botón verde institucional `⬇ Descargar PDF` y botón `✕ Cerrar`.
   - Contenedor con etiqueta `<iframe>` (`#pdfIframe`) que renderiza en tiempo real el blob del documento generado por `jsPDF`.
   - Transmisión de datos mediante el estándar seguro de Django `{{ cotizaciones|json_script:"cotizacionesData" }}`.
3. **Parametrización y Mejoras en el Generador de PDF (`pdfGenerator.js`)**:
   - Se actualizó `buildQuotePDF` para recibir metadatos de cotizaciones persistidas:
     - `quoteNumber`: Muestra el consecutivo real de la tarjeta (ej: `COT-1008`) sin incrementar el contador si ya existe.
     - `quoteUser`: Imprime el responsable directo (`usuario_editor` o `usuario_creador`).
     - `quoteDate`: Fecha y hora formateada de la cotización.
     - `busNumber`: Refleja el vehículo y número de móvil asignado en texto estándar compatible con jsPDF (ej: `Runner  |  BUS-045` o `Runner  |  Bus: 150`), eliminando caracteres emoji no soportados por la fuente WinAnsi de PDF.
   - Se expuso la API del generador en el scope global (`window.buildQuotePDF`, `window.downloadQuotePDF`, `window.getQuotePDFBlobUrl`).
4. **Conexión Estricta de la Botonera y Gestión de Memoria**:
   - **Botón "Vista previa" de tarjeta**: Llama a `verVistaPrevia('{{ cotizacion.id }}')`, compila el PDF de esa cotización, monta el blob en el `iframe` y abre el modal con animación `fadeInModal`.
   - **Botón "Descargar PDF" de tarjeta**: Invoca `descargarPDFDirecto('{{ cotizacion.id }}')` descargando el archivo físico directo sin necesidad de abrir la vista previa.
   - **Botón "⬇ Descargar PDF" dentro del modal**: Invoca `descargarPDFDesdeModal()` descargando el documento activo en el visor.
   - **Liberación de Recursos**: Cierre mediante botón `✕ Cerrar`, clic en el backdrop o tecla `Escape` con revocación explícita de URLs (`URL.revokeObjectURL`) para evitar fugas de memoria en el navegador.

---

## 📅 Hitos Previos: 20 de Octubre, 2026 (Segunda Etapa: Optimización de Tarjetas y Edición Completa)

### ✅ Hitos Completados
1. **Rediseño de Botonera en Tarjetas de Cotización (`lista_cotizaciones.html`)**:
   - Se reemplazó el botón verde "Detalle" por el botón corporativo **"Vista previa"** enlazado a la función `previewPDF('{{ cotizacion.id }}')`.
   - Se incorporó el botón **"Descargar PDF"** con estética verde vibrante corporativa (`#00C851` / `var(--color-primario)` con texto e icono de descarga en blanco), conectado a `generatePDF('{{ cotizacion.id }}')`.
   - Se ajustó la botonera a una cuadrícula ergonómica y responsiva de dos columnas (`Editar` / `Vista previa` / `Descargar PDF` / `Eliminar`).
2. **Badge Visual de Severidad ("LEVE" vs. "GRAVISIMO")**:
   - Implementación de lógica de negocio directa en el template HTML con condicionales `{% if cotizacion.valor_pieza >= 2847000 %}`.
   - Evaluación contra el umbral de 2 SMMLV en Colombia ($2.847.000 COP): badge verde esmeralda para cotizaciones menores ("LEVE") y badge rojo corporativo para montos iguales o superiores ("GRAVISIMO", pasibles de cobro a aseguradora).
3. **Solución Integral al Flujo de Edición de Cotizaciones (`request.session`)**:
   - **Enrutamiento por GET**: El botón "Editar" transmite el ID de cotización como parámetro URL (`/calculadora/?editar_id={{ cotizacion.id }}`).
   - **Backend Django (`views.py`)**: `index(request)` recupera la cotización correspondiente en `request.session['lista_cotizaciones']`, formatea sus campos (`numero_bus`, `tipologia`, `piezas`) y los pasa al contexto en `cotizacion_editar`. Asimismo, `guardar_cotizacion(request)` admite actualización de cotizaciones existentes cuando recibe `editar_id` por POST, inyectando obligatoriamente los campos de auditoría `usuario_editor` (`request.user.username`) y `timestamp_editor` (con zona horaria nativa de Colombia `America/Bogota` vía `django.utils.timezone` y `zoneinfo`), asignando `valor_pieza_editada` y asegurando la persistencia con `request.session.modified = True`.
   - **Frontend Reactivo (`app.js` e `index.html`)**: Adopción de la técnica oficial recomendada por Django `{{ cotizacion_editar|json_script:"editQuoteData" }}` (eliminando advertencias de sintaxis y blindando contra XSS) y lectura mediante `JSON.parse`. Actualización de parámetros de control de caché a `?v=20261020_5` en `app.js` y `style.css`. En `DOMContentLoaded`, `restoreEditQuoteState()` pre-llena `#inputNumeroBus`, sincroniza la tipología vehicular activa y reconstituye `state.selectedParts`. Al cargar el diagrama SVG, `initSVGInteractivity()` añade automáticamente la clase `.selected` a las geometrías involucradas y sincroniza el resumen de cotización.

---

## 📅 Hitos Previos: 20 de Octubre, 2026 (Primera Etapa: Persistencia en Sesión)

### ✅ Hitos Completados
1. **Flujo de Guardado y Persistencia en Sesión (`request.session`)**:
   - Se implementó la vista `guardar_cotizacion` con decorador `@require_POST` en `apps/calculator/views.py`.
   - Se estructuró el diccionario de cotizaciones con los 11 campos empresariales solicitados: `id`, `id_cotizacion`, `usuario_creador`, `tipologia`, `numero_bus`, `pieza`, `valor_pieza`, `valor_pieza_editada`, `usuario_editor`, `timestamp` y `timestamp_editor`.
   - Captura de fecha y hora local de Colombia (`America/Bogota`) con `timezone.localtime()`.
   - Implementación de `request.session.modified = True` para garantizar la persistencia de cambios en la cookie/almacén de sesión.
2. **Formulario de Cotización Integrado en el Carrito**:
   - Inclusión del formulario con `{% csrf_token %}` en `apps/calculator/templates/calculator/index.html` con campo obligatorio para el número de bus/móvil de la flota SAO6 (`numero_bus`).
   - Sincronización automática en `app.js` (`renderCart`) de los campos ocultos (`tipologia`, `pieza`, `valor_pieza`) según las partes interactivas seleccionadas en el SVG y la línea vehicular activa.
   - Validación en cliente para impedir envíos vacíos.
3. **Actualización de la Vista y Plantilla `lista_cotizaciones.html`**:
   - Lectura reactiva desde `request.session['lista_cotizaciones']` con precarga de registros semilla si la sesión está recién iniciada.
   - Reestructuración de la tabla corporativa para reflejar las 11 columnas con chips de tipología, badge de bus móvil y badges de valor editado.

### 🛠️ Decisiones Técnicas
- **Persistencia Volátil Transitoria**: Uso de sesiones nativas de Django como almacenamiento intermedio para validar el ciclo de vida completo de creación y consulta sin requerir schema en MySQL.
- **Doble Compatibilidad de Envío**: La vista `guardar_cotizacion` admite tanto envíos estándar de formularios HTML (`application/x-www-form-urlencoded` con redirección 302) como peticiones asíncronas AJAX (`application/json`).

---

## 📅 Historial: 19 de Octubre, 2026

### ✅ Hitos Completados
1. **Diseño de Arquitectura de Datos para Cotizaciones (MySQL + Django 5.x)**:
   - Se diseñó la estructura de persistencia relacional para `settings.py` (`sao6_calculadora` con motor InnoDB y codificación `utf8mb4_unicode_ci`), documentando la obligatoriedad de la creación previa del schema en MySQL.
   - Se diseñaron los modelos ORM `Cotizacion` y `DetalleCotizacion` con trazabilidad completa de costos (+15% subtotal, +30% mano de obra técnica), dictamen de aseguradoras según los 2 SMMLV de Colombia y permiso de seguridad personalizado `can_edit_cotizacion`.
2. **Implementación de la Vista `lista_cotizaciones` con Mock Data**:
   - Se implementó la vista basada en función (FBV) en `apps/calculator/views.py` con datos simulados en memoria (Runner, NPR y Agrale) para operar de forma desacoplada antes de la migración a MySQL.
   - Se incorporó la lógica de control de acceso estricto que evalúa en el servidor los permisos del usuario (`can_edit_cotizacion`, superusuario o usuario autorizado como `natalia_ospina`) para inyectar la bandera booleana `puede_editar` en el contexto.
   - Se registró la ruta `/cotizaciones/` en `apps/calculator/urls.py` con el namespace `calculator:lista_cotizaciones`.
3. **Plantilla Corporativa y Visualización de Cotizaciones (`lista_cotizaciones.html`)**:
   - Creación de `apps/calculator/templates/calculator/lista_cotizaciones.html` bajo el sistema de diseño de SAO6 S.A.S. (KPIs de umbral de aseguradora y factores, badges de severidad, tabla responsiva y buscador en tiempo real).
   - Aplicación del control de permisos en la presentación: los botones de edición solo se renderizan en el DOM si `puede_editar` es `True`, manteniendo el modo consulta/solo lectura para usuarios estándar.
   - Se integró el acceso a "Cotizaciones" en la barra de navegación global de `apps/theme/templates/theme/base.html`.

### 🛠️ Decisiones Técnicas
- **Desacoplamiento Progresivo**: Desarrollo del módulo de visualización con datos en memoria (Mock Data) para validar flujos de UX/UI y control de acceso antes de aplicar cambios estructurales en la base de datos de producción.
- **Seguridad en Dos Capas**:
  - *Capa de Presentación*: Ocultamiento de acciones mediante condicionales `{% if puede_editar %}` en el template.
  - *Capa de Backend (Planificada)*: Uso de `@permission_required(..., raise_exception=True)` o `PermissionDenied` para retornar HTTP 403 Forbidden ante intentos de acceso directo por URL.

---

## 📅 Historial: 18 de Octubre, 2026

### ✅ Hitos Completados
1. **Modularización Arquitectónica del Frontend (ES6 Modules)**:
   - Se desacopló la lógica monolítica de `calculator.js` y `pdf_preview.js` en una arquitectura modular de 3 capas independientes bajo el principio de responsabilidad única (SRP):
     - **`api.js` (Capa de Acceso a Datos / DAL)**: Maneja peticiones asíncronas a `/api/get-price/`, previene condiciones de carrera (*race conditions*) ante clics rápidos mediante `AbortController`, implementa cancelación masiva al cambiar de vista y mantiene una caché en memoria en el cliente para reducir la carga sobre el backend de Django y MySQL.
     - **`pdfGenerator.js` (Capa de Dominio y Reportes)**: Renderizado de documentos corporativos con `jsPDF` (2.5.1), cálculo milimétrico de coordenadas $(x, y)$, paginación dinámica con repetición de cabeceras, pre-carga del logo corporativo de SAO6 con fallback vectorial, cálculo de recargo del 15% de subtotal, 30% de mano de obra y aplicación del dictamen de aseguradoras según el umbral de 2 SMMLV en Colombia ($2.847.000 COP).
     - **`app.js` (Orquestador de UI y Controlador)**: Gestiona el estado reactivo global (`selectedParts`, `currentVehicleType`, `currentViewName`), administra la interactividad de los diagramas SVG, actualiza la interfaz del carrito y establece un puente global (`window`) para mantener total retrocompatibilidad con los eventos inline de la plantilla Django.
2. **Integración en Plantillas Django**:
   - Se actualizó `apps/calculator/templates/calculator/index.html` para cargar el punto de entrada como módulo ES6 (`<script type="module" src="{% static 'theme/js/app.js' %}">`), resolviendo de forma nativa las dependencias sin necesidad de bundlers pesados.

### 🛠️ Decisiones Técnicas
- **Gestión de Concurrencia**: Uso de `AbortController` mapeado por referencia inteligente (`baseId`), abortando peticiones obsoletas y evitando que respuestas tardías sobreescriban el estado visual.
- **Prevención de Fugas de Memoria**: Liberación explícita de recursos Blob en la previsualización del PDF mediante `URL.revokeObjectURL`.
- **Cero Breaking Changes**: Exposición deliberada de métodos clave al objeto `window` en `app.js` para compatibilidad transparente con los atributos `onclick` existentes en el HTML.

---

## 📅 Historial: 01 de Julio, 2026

### ✅ Hitos Completados
1. **Selector Multi-Vehículo**: Se implementó una interfaz de pestañas en `index.html` para alternar entre diferentes líneas de vehículos ("Runner", "NPR", "Agrale").
2. **Lógica Dinámica de Carga SVG**: Se actualizó `calculator.js` para construir rutas dinámicas a las carpetas y archivos SVG correspondientes a cada vehículo (ej. `img-npr/FrontalNpr.svg`, `img-agrale/FrontalAgrale.svg`).
3. **Arquitectura de Base de Datos / Precios**: Se planificó la estructura para obtener precios en tiempo real. Se acordó que los IDs de Figma coincidirán con las referencias del Excel de almacén (ej. `RCEX0065`) para prescindir de diccionarios intermedios y asegurar una automatización directa.

---

## 📅 Historial: 02 de Junio, 2026

### ✅ Hitos Completados
1. **Unificación de Activos Visuales**: Se migró de la técnica de superposición (Overlay) a una técnica de "SVG Integrado", incrustando la fotografía del vehículo directamente dentro del SVG mediante Figma. Esto garantiza una alineación perfecta e indestructible entre el auto y las piezas interactivas.
2. **Corrección de Renderizado Base64**: Implementación de un script inteligente en `calculator.js` que procesa dinámicamente los patrones (`<pattern>`) del SVG inyectado para convertirlos en etiquetas `<image>` nativas, solucionando un bug común de los navegadores al renderizar imágenes base64 en SVGs en línea (inline).
3. **Soporte Extendido de Geometrías**: Se actualizó la lógica interactiva para incluir `ellipse`, `polygon` y `circle` además de los `path` (lo cual es esencial para hacer seleccionables geometrías circulares como los rines).
4. **Limpieza y Optimización**: Se limpió `index.html` para remover la carga dual de imágenes, se dejó `Izquierdo` como vista activa y se implementó "cache busting" (`?v=2`) en los assets estáticos.

---

## 📅 Historial: 13 de Mayo, 2026

### ✅ Hitos Completados
1. **Reorganización Estructural**: Se implementó una arquitectura limpia moviendo las aplicaciones a un directorio `apps/` y organizando los archivos estáticos en `static/assets/`.
2. **Configuración de Aplicaciones**:
   - `apps.calculator`: Lógica principal del proyecto y servicios de cotización.
   - `apps.theme`: Sistema de diseño, estilos y orquestación interactiva frontend.
3. **Personalización del Reporte Oficial PDF**:
   - Eliminación de secciones prescindibles: tramitado por, validez, documento oficial, observaciones y criterios de aseguradora.
   - Estandarización de la denominación formal: sustitución del término "Bus" por "Unidad".
4. **Módulo de Autenticación Corporativa (Login)**:
   - Acceso seguro mediante Correo Corporativo y Cédula de Ciudadanía.
   - Interfaz moderna con split layout, sidebar verde corporativo SAO6 (`#0A4D2E` / `#00C851`) y validación de usuarios activos.
5. **Integración de Flota Automática (`vehiculo.xlsx`)**:
   - Lectura optimizada del archivo `apps/data/vehiculo.xlsx` con 261 unidades indexadas por `numero de vehiculo` y `linea` (Runner, NPR, Agrale).
   - Implementación de `apps/calculator/vehicle_service.py` con caché en memoria y doble parser (`openpyxl` con fallback en librería estándar `zipfile` + `xml.etree`).
   - Endpoint REST `/api/vehiculos/buscar/` para búsqueda instantánea por número o texto normalizado.
6. **Flujo de Selección Previa de Unidad en Cotizador**:
   - Modal corporativo al ingresar a `/calculadora/` que solicita el número de móvil antes de seleccionar piezas.
   - Autocompletado reactivo en cliente con sugerencias rápidas (`001`, `165`, `235`) y selección manual de contingencia si la unidad no está registrada.
   - Tarjeta informativa superior (`#activeVehicleCard`) que reemplaza los botones arbitrarios de modelos, bloquea el vehículo a su línea correspondiente y exhibe **únicamente las caras de la unidad seleccionada**.
   - Botón *"Cambiar Unidad"* con validación de reseteo para prevenir mezclas de diagramas de diferentes vehículos.
   - Sincronización total con `#inputNumeroBus`, guardado en MySQL y soporte transparente para cotizaciones en modo edición (`editar_id`).

---

### 🛠️ Decisiones Técnicas
- **Estructura de Apps**: Uso de un prefijo `apps.` para evitar colisiones de nombres y mantener la raíz limpia.
- **Técnica de Visualización**: Superposición de SVG sobre imagen (Overlay) para permitir interactividad en partes específicas del vehículo sin perder el realismo de la fotografía original.
- **Estilo Visual**: Adherencia a la estética corporativa SAO6 (verde `#00c851` / `#0A4D2E`, bordes redondeados, glassmorphism y micro-animaciones).
- **Control de Flujo de Cotización**: Restricción del cotizador a las caras específicas de la unidad para garantizar que las piezas y referencias pertenezcan estrictamente al modelo vehicular seleccionado.

---

### 🚀 Próximos Pasos
- [x] Implementar servicio y endpoint para búsqueda de vehículos en `vehiculo.xlsx`.
- [x] Desarrollar modal de identificación de unidad y filtrado de caras por línea en la calculadora.
- [ ] Digitalizar e incorporar diagramas vectoriales para las vistas faltantes de la línea Agrale y laterales específicos.
- [ ] Incorporar estadísticas de accidentalidad agrupadas por línea de vehículo en el panel de cotizaciones.
