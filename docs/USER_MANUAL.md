# Manual de usuario de MC Send Notify

Autor: **Ing. Heri Espinosa**

Este manual explica cómo poner en marcha y usar MC Send Notify. Se amplía en cada fase del proyecto. Las funciones marcadas como _Próximamente_ todavía no están disponibles.

## 1. ¿Qué es MC Send Notify?

Es la plataforma de Multicómputos para enviar correos a los clientes de cada aplicación o producto:

- actualizaciones de versión;
- resúmenes semanales;
- comunicados con documentos adjuntos.

Cada aplicación (por ejemplo MCSupport o MCLog) tiene su propio espacio, con sus contactos, listas, segmentos, miembros y claves de API. Los datos de una aplicación nunca son visibles desde otra.

## 2. Instalación

Esta sección es para el equipo técnico que instala la plataforma.

### En un equipo de desarrollo

1. Instala Node.js 24, pnpm 11 y Docker Desktop.
2. En la carpeta del proyecto, ejecuta:

   ```bash
   pnpm install
   pnpm setup
   ```

3. Inicia la aplicación y el procesador de tareas en dos terminales:

   ```bash
   pnpm dev
   pnpm dev:worker
   ```

   Para procesar documentos, el procesador de tareas necesita poppler. En Windows es más sencillo ejecutarlo en Docker con `docker compose up -d --build worker`, en lugar de `pnpm dev:worker`.

4. Abre http://localhost:3020 en el navegador.
5. Entra con `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD`. `pnpm setup` genera la contraseña y la guarda en tu archivo `.env`; no la compartas.

### En un servidor (producción)

1. Copia `.env.example` a `.env` y completa los valores.
   - Genera cada secreto con `openssl rand -base64 32`.
   - Define `APP_URL` y `APP_DOMAIN` con el dominio público.
   - Para el inicio de sesión con Microsoft, registra una aplicación en Microsoft Entra ID con la URL de retorno `https://tu-dominio/api/auth/callback/microsoft-entra-id`. Después completa las variables `AUTH_MICROSOFT_ENTRA_ID_*` y `AUTH_ALLOWED_EMAIL_DOMAINS`.
2. Apunta el dominio al servidor y abre los puertos 80 y 443.
3. Ejecuta:

   ```bash
   docker compose -f compose.yaml -f compose.prod.yaml up -d --build
   ```

4. Comprueba `https://tu-dominio/api/health/ready`: debe responder `"status":"ok"`.

## 3. Primeros pasos

### Iniciar sesión

1. Abre la aplicación. Si no has iniciado sesión, verás la página de acceso.
2. Entra con tu correo y contraseña, o con **Continuar con Microsoft** si tu organización lo tiene activado.
3. Tras 5 intentos fallidos, la cuenta se bloquea 15 minutos por seguridad.

### Recuperar la contraseña

1. En la página de acceso, pulsa **¿Olvidaste tu contraseña?** y escribe tu correo.
2. Si la dirección corresponde a una cuenta con contraseña, recibirás un enlace. Por seguridad, la página muestra el mismo mensaje exista o no la cuenta.
3. El enlace caduca en 1 hora y solo sirve una vez. Elige una contraseña de al menos 12 caracteres.
4. Al guardarla se cierran las sesiones abiertas en otros dispositivos.

Si entras con Microsoft, tu contraseña se gestiona en Microsoft 365, no aquí.

### Elegir la aplicación

Si perteneces a varias aplicaciones, elige una en **Elige una aplicación**. Puedes cambiar en cualquier momento desde el selector situado arriba a la izquierda.

### Roles

| Rol           | Puede                                                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Propietario   | Todo, incluida la gestión de otros propietarios                                                                                                                        |
| Administrador | Todo salvo gestionar propietarios                                                                                                                                      |
| Editor        | Gestionar contactos, importaciones, listas, segmentos, etiquetas, plantillas y documentos; crear y enviar campañas; usar la IA; gestionar novedades y automatizaciones |
| Lector        | Consultar contactos, listas, segmentos, miembros, plantillas, documentos, campañas, novedades y automatizaciones                                                       |

Solo los propietarios y administradores configuran los proveedores de correo y los remitentes.

### Idioma y tema

- **Idioma:** botones **ES** y **EN** en la barra superior.
- **Tema:** icono de luna o sol para cambiar entre modo claro y oscuro. Por defecto se sigue la preferencia del sistema.

## 4. Contactos

### Ver y buscar

En **Contactos** verás la tabla de contactos. Puedes:

- buscar por email, nombre o empresa;
- filtrar por estado, lista o segmento;
- ordenar por columna y cambiar el número de filas por página.

### Crear o editar un contacto

1. Pulsa **Nuevo contacto**, o pulsa el email de un contacto existente.
2. Completa los datos principales. El email es obligatorio y no puede repetirse dentro de la aplicación.
3. Rellena los **campos personalizados**, asigna **listas** y **etiquetas**, y marca los **temas de suscripción**.
4. Pulsa **Guardar**.

**Eliminar** borra los datos personales de forma permanente (derecho al olvido).

### Importar contactos desde CSV o Excel

1. Ve a **Importar** y arrastra el archivo, o pulsa la zona de carga. Se admite `.csv` o `.xlsx` de hasta 20 MB y 100.000 filas.
2. **Relaciona las columnas:** la plataforma sugiere el campo de cada columna. La columna de email es obligatoria.
3. Elige qué hacer si el email ya existe:
   - **Actualizar:** completa los datos vacíos y los atributos. No cambia el estado, así que un contacto dado de baja sigue de baja.
   - **Omitir:** no modifica los contactos existentes.
4. Opcionalmente, elige una **lista** donde añadirlos y escribe el **origen del consentimiento** (por ejemplo "Formulario web").
5. Pulsa **Iniciar importación**. Verás el progreso y, al terminar, el resumen: creados, actualizados, omitidos y con errores.
6. Si hay filas con errores, pulsa **Descargar informe de errores** para ver la fila y el motivo de cada una.

Consejos:

- Las fechas se aceptan como `2026-12-01` o `01/12/2026`.
- Las opciones de un campo de selección no distinguen mayúsculas.
- Los archivos de Excel en español con separador punto y coma se reconocen automáticamente.

## 5. Listas y segmentos

- **Listas:** grupos fijos de contactos. Crea una en **Listas → Nueva lista** y añade contactos:
  - desde la tabla de contactos (selección múltiple y **Añadir a lista**);
  - desde el formulario de cada contacto;
  - al importar.
- **Segmentos:** grupos dinámicos que se recalculan cada vez.
  1. En **Segmentos → Nuevo segmento**, elige si deben cumplirse **todas** o **alguna** de las condiciones.
  2. Añade condiciones, por ejemplo "País es igual a DO" o "Fecha de alta en los últimos 30 días".
  3. Usa **Añadir grupo** para combinar condiciones, como "(A y B) o C".
  4. El recuento de contactos se actualiza mientras editas.
  5. **Ver contactos** abre la tabla filtrada por el segmento.

## 6. Documentos

En **Documentos** guardas los archivos que quieres enlazar en tus correos. Para cada uno, la plataforma genera una miniatura de la primera página y extrae el texto.

1. Arrastra un archivo a la zona de carga o pulsa para seleccionarlo. Se admiten:
   - presentaciones: PPTX, PPT y ODP;
   - documentos: PDF, DOCX, DOC y ODT;
   - hojas de cálculo: XLSX, XLS y ODS;
   - imágenes: PNG, JPG, GIF y WebP;
   - HTML, Markdown y texto.
2. El tamaño máximo es 50 MB. Por seguridad no se admiten SVG, ejecutables ni archivos comprimidos.
3. El documento aparece como **En cola** y después **Procesando**. En unos segundos pasa a **Listo** con su miniatura; la página se actualiza sola.
4. Pulsa un documento para ver su detalle:
   - miniatura, tipo, páginas, tamaño y texto extraído;
   - **Descargar original**, **Abrir PDF** y **Cambiar título**;
   - **Reintentar**, si el procesamiento falló;
   - **Eliminar**. Las plantillas que lo usan mostrarán un aviso y los enlaces de los correos ya enviados dejarán de funcionar.

Usa el buscador y el filtro **Tipo** para encontrar documentos.

## 7. Plantillas de correo

### Crear una plantilla

1. En **Plantillas**, pulsa **Nueva plantilla**.
2. Escribe el nombre y el asunto, elige el idioma del correo y el formato:
   - **Bloques** (recomendado): editor visual por bloques.
   - **Markdown:** un texto con formato sencillo.
   - **HTML:** pega tu propio HTML. Se limpia de scripts y contenido peligroso y se envuelve con la marca de la aplicación.
3. Pulsa **Crear**. Se abre el editor.

### El editor

- **Mensaje:** asunto (se recomiendan 78 caracteres como máximo), preencabezado (el texto que se ve junto al asunto en la bandeja) e idioma.
- **Contenido (bloques):** pulsa **Añadir bloque** y elige:
  - **Titular** y **Texto** (admite Markdown: `**negrita**`, listas, enlaces);
  - **Botón** con enlace;
  - **Imagen** desde una URL https o desde la biblioteca de documentos, con texto alternativo obligatorio;
  - **Documento con miniatura**: tarjeta con la miniatura del documento, su tipo y páginas, y un botón para descargarlo;
  - **Dos columnas**, **Separador** y **Espacio**.

  Usa las flechas para cambiar el orden, el icono de copiar para duplicar y la papelera para quitar un bloque.

- **Variables:** abre **Variables disponibles** y copia la que necesites, por ejemplo `{{ contact.first_name }}` o `{{ fields.plan }}`. Para que una variable tenga un valor por defecto, escribe `{{ contact.company | default: "tu equipo" }}`.

### Vista previa y comprobaciones

- La vista previa se actualiza mientras escribes. Puedes verla en **escritorio** o **móvil**, en **modo claro** u **oscuro**, y **como** un contacto real o el contacto de ejemplo.
- **Comprobaciones antes de enviar** avisa de lo que conviene corregir:
  - errores: falta la dirección postal, hay un documento no disponible o una variable mal escrita;
  - avisos: variable desconocida, asunto largo, sin preencabezado, imágenes sin texto alternativo, enlaces sin https, o correo de más de 102 KB (Gmail lo recortaría).

### Guardar y versiones

- **Guardar versión** crea una versión nueva. Puedes añadir una nota, por ejemplo "Nuevo asunto".
- Si otra persona guardó la plantilla mientras la editabas, se te avisa y no se pierde su trabajo. Recarga la página para ver la última versión.
- **Historial** muestra todas las versiones, con autor y fecha. **Restaurar** crea una versión nueva con el contenido antiguo.
- Si sales con cambios sin guardar, el navegador te avisará.

En la lista de plantillas también puedes **duplicar** o **eliminar** una plantilla.

## 8. Campañas

Una campaña envía una plantilla a una audiencia (listas y segmentos) desde un remitente. Antes de la primera campaña, la aplicación necesita un **proveedor de correo** y un **remitente** (ver [Configuración](#9-configuración)).

### Crear una campaña

1. En **Campañas**, pulsa **Nueva campaña**, ponle un nombre y elige la plantilla.
2. El asistente tiene cinco pasos. Puedes moverte entre ellos con **Siguiente**, **Volver** o pulsando el nombre del paso. Los cambios se guardan como borrador al cambiar de paso o con **Guardar borrador**.

| Paso         | Qué haces                                                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contenido    | Revisas la plantilla. Si necesitas cambiarla, pulsa **Editar la plantilla**: la campaña usa la versión vigente en el momento de programarla.            |
| Audiencia    | Eliges listas y segmentos, listas para **excluir** y, opcionalmente, un **tema de suscripción**. Ves en vivo cuántos destinatarios recibirán el correo. |
| Envío        | Eliges el remitente, un **asunto alternativo** para la prueba A/B (opcional), si se registran aperturas y clics, y un máximo de envíos por hora.        |
| Revisión     | Ves las comprobaciones y la vista previa. Puedes mandar una **prueba** a hasta 5 direcciones.                                                           |
| Programación | **Enviar ahora** o **Programar para más tarde** (fecha y hora de tu navegador).                                                                         |

Notas:

- **Quién no recibe la campaña:**
  - contactos dados de baja, con rebote permanente, con queja o suprimidos;
  - quien se dio de baja del tema elegido.
- **Un solo correo por persona:** un contacto que esté en varias listas recibe un único correo.
- **Comprobaciones:**
  - con errores (por ejemplo, falta la dirección postal o un documento eliminado) la campaña no se puede enviar;
  - los avisos (por ejemplo, DNS del remitente incompleto) permiten enviar, pero conviene corregirlos.
- **Confirmación:** a partir de 500 destinatarios hay que escribir el número exacto para evitar envíos por error.
- **Prueba A/B:** la mitad de los destinatarios recibe el asunto A y la otra mitad el B. El informe compara aperturas y clics. La elección de la versión ganadora es manual.
- **Envío de prueba:**
  - lleva `[Prueba]` delante del asunto;
  - usa un contacto de ejemplo;
  - no registra aperturas ni clics.

### Seguir el envío

Al lanzar la campaña se abre su informe, que se actualiza solo cada pocos segundos:

- **Progreso:** cuántos correos se han procesado del total.
- **Métricas:**
  - destinatarios, enviados (y confirmados por el proveedor);
  - aperturas y clics (personas únicas), descargas de documentos;
  - bajas, rebotes, quejas, fallidos y no enviados (suprimidos durante el envío).
- **Enlaces:** clics y personas por cada enlace.
- **Entregas:** tabla con buscador y filtro por estado, con el detalle de cada correo.

Acciones disponibles:

| Acción               | Cuándo                            | Efecto                                                         |
| -------------------- | --------------------------------- | -------------------------------------------------------------- |
| **Desprogramar**     | Campaña programada                | Vuelve a borrador                                              |
| **Pausar**           | Enviándose                        | Detiene el envío; los correos pendientes esperan               |
| **Reanudar**         | En pausa                          | Continúa desde donde se quedó, sin repetir correos ya enviados |
| **Cancelar campaña** | Programada, enviándose o en pausa | Los correos pendientes no se envían. No se puede deshacer      |

Si el proveedor rechaza las credenciales durante el envío, la campaña se **pausa sola** y el informe lo explica. Corrige el proveedor, pulsa **Probar conexión** y después **Reanudar**.

Desde la lista de campañas también puedes **duplicar** una campaña (por ejemplo, para repetir un envío) o eliminar un borrador o una campaña cancelada.

### Sobre las métricas

- **Aperturas:**
  - se miden con una imagen invisible, así que quien bloquea las imágenes no cuenta;
  - las aperturas automáticas (por ejemplo, Apple Mail Privacy Protection) se muestran aparte y no se suman.
- **Clics:**
  - los antivirus de correo que comprueban los enlaces (por ejemplo, Microsoft Safe Links) no cuentan como clics;
  - un clic cuenta también como apertura.
- **Entregas, rebotes y quejas:** solo los informan Resend y Amazon SES. Con SMTP o Microsoft 365 solo se ven los rechazos inmediatos.

### Lo que ve tu cliente al darse de baja

Cada correo incluye en el pie un enlace a las **preferencias de suscripción**:

- muestra su dirección parcialmente oculta;
- permite elegir qué temas recibir o **darse de baja de todo**.

Gmail, Outlook y Yahoo muestran además un botón **Cancelar suscripción** junto al remitente, que da de baja en un solo clic:

- si la campaña tiene tema, solo de ese tema;
- si no lo tiene, de todas las comunicaciones de la aplicación.

La baja es inmediata y se respeta aunque la campaña siga enviándose.

### Panel de inicio

**Inicio** muestra los totales de contactos, listas y segmentos, la actividad de los últimos 30 días (enviados, aperturas y clics) y las campañas recientes. La gráfica tiene una tabla equivalente para lectores de pantalla.

## 9. Configuración

| Sección                 | Para qué sirve                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| General                 | Nombre, idioma, zona horaria y **dirección postal** (obligatoria en el pie de los correos comerciales) |
| Marca de los correos    | Logotipo, color principal, color de los botones y texto del pie de todos los correos                   |
| Proveedores de correo   | Servicios que envían los correos: SMTP, Microsoft 365, Resend o Amazon SES                             |
| Remitentes              | Direcciones desde las que se envía y estado de su autenticación DNS                                    |
| Inteligencia artificial | Proveedor de IA, modelos, presupuesto mensual y uso del mes                                            |
| Miembros                | Invitar personas, cambiar su rol o quitarles el acceso                                                 |
| Campos personalizados   | Datos adicionales de los contactos: texto, número, fecha, sí/no o selección                            |
| Etiquetas               | Marcas libres para clasificar contactos                                                                |
| Temas de suscripción    | Tipos de comunicación que el contacto puede aceptar o rechazar, como "Resumen semanal"                 |
| Claves de API           | Integraciones de otras aplicaciones con la API de contactos                                            |
| Actividad               | Registro de quién hizo qué y cuándo                                                                    |

### Invitar a un miembro

1. En **Miembros**, pulsa **Invitar**, escribe el correo y elige el rol.
2. La persona recibe un correo con la invitación (si la plataforma tiene configurado el correo del sistema). También aparece el enlace para copiarlo y enviarlo por otro medio. Caduca en 7 días y solo se muestra una vez.
3. Al abrir el enlace:
   - si la persona no tiene cuenta, crea una contraseña de al menos 12 caracteres;
   - si ya tiene cuenta, inicia sesión con ese mismo correo y acepta.

### Marca de los correos

1. **Logotipo:** arrastra un PNG, JPEG o WebP de hasta 2 MB. Se ajusta a 480×160 px. Si no hay logotipo, la cabecera muestra el nombre de la aplicación.
2. **Color principal:** se usa en enlaces y en la franja superior. Debe contrastar con el blanco.
3. **Color de los botones:** el texto del botón se elige automáticamente, blanco u oscuro.
4. El panel **Contraste (WCAG AA)** indica si cada color **Cumple**. Si no cumple, no se puede guardar.
5. **Texto del pie** (opcional): admite Markdown sencillo. La dirección postal y los enlaces de baja se añaden siempre.

### Proveedores de correo

1. En **Proveedores de correo**, pulsa **Nuevo proveedor**, ponle un nombre y elige el tipo.

| Tipo          | Cuándo usarlo                                                           | Datos necesarios                                                                    |
| ------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| SMTP          | Servidor propio o volúmenes bajos                                       | Servidor, puerto, seguridad (STARTTLS o TLS), usuario y contraseña                  |
| Microsoft 365 | Envíos desde un buzón corporativo (máx. ~30 por minuto y 10.000 al día) | Id. de inquilino, id. de aplicación y secreto de cliente con el permiso `Mail.Send` |
| Resend        | Envíos masivos con informes de entrega, rebotes y quejas                | Clave de API (`re_…`) y, para los eventos, el secreto del webhook (`whsec_…`)       |
| Amazon SES    | Grandes volúmenes                                                       | Región, Access key ID, Secret access key y, para los eventos, un Configuration Set  |

2. Ajusta los **envíos por segundo** (admite decimales: 0,5 equivale a 30 por minuto) y el **máximo al día** a los límites de tu cuenta del proveedor. La plataforma nunca los supera, aunque haya varias campañas a la vez.
3. Pulsa **Probar conexión**. El proveedor queda **Operativo** o **Con error**, con el motivo.
4. **Eventos (Resend y SES):** copia la **URL para eventos** que muestra la tarjeta del proveedor:
   - en Resend, crea un webhook con esa URL para los eventos _delivered_, _bounced_ y _complained_, y pega su secreto en el proveedor;
   - en SES, crea un tema SNS con una suscripción HTTPS a esa URL y asócialo al Configuration Set (la suscripción se confirma sola).

Las credenciales se guardan cifradas y nunca se vuelven a mostrar. Al editar, deja vacío un campo secreto para conservar el valor guardado. Un proveedor con remitentes no se puede eliminar.

### Remitentes

1. En **Remitentes**, pulsa **Nuevo remitente**. Escribe el nombre visible, el email y, opcionalmente, una dirección de respuesta. Elige el proveedor.
2. El email debe pertenecer a un dominio verificado en el proveedor.
3. Al guardarlo se comprueban los registros DNS **SPF**, **DKIM** y **DMARC** del dominio. Gmail y Yahoo los exigen a los remitentes masivos; sin ellos, los correos pueden acabar en spam. Pulsa **Comprobar DNS** después de corregirlos.
4. Marca un **remitente por defecto**: las campañas nuevas lo usan automáticamente.

### Crear una clave de API

1. En **Claves de API**, pulsa **Nueva clave**, ponle un nombre y elige los permisos y la caducidad.
2. **Copia la clave en ese momento.** Por seguridad, no se vuelve a mostrar.
3. Úsala desde tu aplicación con la cabecera `Authorization: Bearer <clave>` contra `/api/v1/contacts` (contactos) o `/api/v1/changelog` (novedades, permiso «Publicar novedades»). El README tiene un ejemplo.
4. Si la clave se expone, pulsa **Revocar**: deja de funcionar de inmediato.

### Inteligencia artificial

Solo propietarios y administradores. Mientras no esté configurada, los botones de IA no aparecen.

1. En **Inteligencia artificial**, elige el origen:
   - **IA de la plataforma:** Claude con la cuenta de Multicómputos, con un presupuesto máximo fijado por la plataforma;
   - **Clave propia:** Anthropic (recomendado), OpenAI o un servidor compatible como Ollama (indica su URL, p. ej. `http://ollama:11434/v1`).
2. Elige el **modelo principal** y, si quieres, un **modelo rápido** para tareas cortas (asuntos, tono, resúmenes).
3. Fija el **presupuesto mensual**. Al alcanzarlo, la IA se bloquea hasta el día 1 del mes siguiente (UTC).
4. Pulsa **Guardar** y después **Probar conexión**.

El panel **Uso de este mes** muestra el gasto, las peticiones y el coste por tipo de uso. Al proveedor solo se envían las fuentes y textos necesarios para cada tarea, nunca la lista de contactos.

## 10. IA, novedades y automatizaciones

### Redactar con IA

En **Plantillas** o en el paso **Contenido** de una campaña, pulsa **Redactar con IA**.

1. **Añadir fuente:**
   - texto (notas o un borrador);
   - página web pública;
   - feed RSS;
   - documento de la biblioteca;
   - novedades del buzón.
2. Escribe instrucciones (opcional) y elige el tono y el idioma.
3. Pulsa **Generar borrador**. Verás la vista previa, el coste aproximado y, si la IA propuso enlaces que no estaban en las fuentes, el aviso de que se eliminaron.
4. Pulsa **Guardar como plantilla**. En una campaña, la plantilla nueva queda seleccionada.

La IA solo puede enlazar URL que aparezcan en las fuentes. Las páginas de redes internas o direcciones reservadas se rechazan por seguridad.

### Asistente en el editor de plantillas

- **Sugerir asuntos:** cinco propuestas con avisos de riesgo (muy largo, todo en mayúsculas, palabras de spam...). Pulsa **Usar** para aplicarla.
- **Ajustar el tono:** reescribe los textos con el tono elegido. Revisa y guarda.
- **Traducir:** crea una copia de la plantilla en el otro idioma.

La IA no cambia enlaces, documentos, variables ni estructura. Si una propuesta no es válida, ese texto conserva su versión original y se avisa.

### Segmentos con IA

Al crear o editar un segmento, describe la audiencia (por ejemplo, «clientes activos que hablan inglés») y pulsa **Generar reglas**. Revisa las reglas propuestas y el recuento antes de guardar.

### Resumen de resultados

En el informe de una campaña enviada, pulsa **Generar resumen** para obtener la conclusión principal, los datos clave y recomendaciones.

### Novedades

**Novedades** es el buzón de la aplicación: lo que se publica aquí alimenta el resumen periódico.

- Pulsa **Nueva novedad** para añadirla a mano (título, versión, tipo y descripción).
- Las aplicaciones pueden publicar por API con una clave con el permiso **Publicar novedades**. Con `externalId`, repetir la llamada actualiza la novedad en lugar de duplicarla.
- El estado indica si ya se envió en algún resumen.

### Automatizaciones

1. En **Automatizaciones**, pulsa **Nueva automatización**.
2. **Nombre y programación:** frecuencia (diaria, semanal o mensual), día, hora y zona horaria.
3. **Contenido:** fuentes (normalmente «Novedades del buzón»), instrucciones, tono e idioma. Con **No enviar si no hay novedades nuevas**, una semana sin novedades no genera correo.
4. **Audiencia y remitente:** listas, segmentos, exclusiones, tema de suscripción y remitente.
5. **Aprobación** (recomendada): aprobadores, plazo para decidir y qué hacer si nadie decide (cancelar o enviar).
6. Guarda y **activa** la automatización. Con **Ejecutar ahora** puedes probarla sin esperar a la programación.

El **historial de ejecuciones** muestra cada ejecución:

- **Esperando aprobación**;
- **Enviada a la cola**;
- **Omitida**, si no había novedades;
- **Rechazada**;
- **Caducada**;
- **Error**, con el motivo.

Cada ejecución enlaza a su campaña y a su aprobación.

### Aprobaciones

Cuando una automatización prepara una campaña, los aprobadores reciben un correo y el menú **Aprobaciones** muestra un contador.

1. Abre la aprobación (desde el correo o el menú). Necesitas haber iniciado sesión.
2. Revisa la vista previa, el asunto y los destinatarios. Si la IA propuso enlaces que se eliminaron, verás un aviso: lee con atención el texto que los acompañaba.
3. Pulsa **Aprobar y enviar** para que salga ahora, o **Rechazar** para devolverla a borrador. Puedes dejar un comentario.

Solo deciden los aprobadores designados, propietarios y administradores. Si la plantilla se edita mientras la revisas, la aprobación falla para que no se envíe algo distinto de lo revisado.

## 11. Funciones próximas

| Función                                                   | Estado                |
| --------------------------------------------------------- | --------------------- |
| Instalación como aplicación (PWA)                         | Próximamente (Fase 5) |
| Texto alternativo de imágenes con IA y webhooks salientes | Próximamente (Fase 5) |

## 12. Resolución de problemas

| Problema                                                            | Qué hacer                                                                                             |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| "Email o contraseña incorrectos"                                    | Revisa los datos. Tras 5 intentos, espera 15 minutos                                                  |
| "Tu cuenta de Microsoft no tiene acceso"                            | Tu dominio no está en la lista permitida; pide acceso a un administrador                              |
| No ves una aplicación                                               | Pide a un propietario o administrador que te invite                                                   |
| La página muestra 404 en una aplicación                             | No eres miembro de esa aplicación o el enlace es incorrecto                                           |
| Una importación se queda "En cola"                                  | El procesador de tareas no está en marcha (`pnpm dev:worker` o el contenedor `worker`)                |
| "Solo se admiten archivos CSV o XLSX válidos"                       | Guarda el archivo como CSV UTF-8 o como libro de Excel (.xlsx)                                        |
| El estado muestra `database: down`, `redis: down` o `storage: down` | Ejecuta `docker compose up -d postgres redis storage` y vuelve a comprobar                            |
| `pnpm setup` falla con "port is already allocated"                  | Otro proyecto usa ese puerto: cámbialo en `compose.override.yaml` y en `.env`                         |
| La construcción de Docker falla con errores de certificado          | Sigue las instrucciones de `docker/certs/README.md`                                                   |
| Un documento se queda "En cola"                                     | El procesador de tareas no está en marcha                                                             |
| Un documento muestra "Faltan herramientas de conversión"            | El procesador de tareas no tiene poppler: ejecútalo en Docker (`docker compose up -d worker`)         |
| Un documento queda en "Error"                                       | Comprueba que el archivo se abre y no tiene contraseña; después pulsa **Reintentar**                  |
| "Otra persona guardó la plantilla mientras la editabas"             | Recarga la página: verás la última versión y podrás volver a aplicar tus cambios                      |
| "Contraste insuficiente" al guardar la marca                        | Elige un color más oscuro para los enlaces o cambia el color de los botones                           |
| La vista previa dice que hay campos incompletos                     | Revisa los bloques: los botones necesitan un enlace https y las imágenes, texto alternativo           |
| **Probar conexión** falla con un error de autenticación             | Revisa usuario y contraseña, o la clave de API; en Microsoft 365, que la aplicación tenga `Mail.Send` |
| Una campaña se pausó sola                                           | El proveedor rechazó las credenciales: corrígelas, **Probar conexión** y **Reanudar**                 |
| Una campaña programada no sale                                      | El procesador de tareas no está en marcha (`docker compose up -d worker`)                             |
| El número de destinatarios es menor de lo esperado                  | Se excluyen bajas, rebotes, quejas, supresiones y bajas del tema elegido                              |
| Los correos llegan a spam                                           | Corrige SPF, DKIM y DMARC del remitente (**Comprobar DNS**) y reduce los envíos por segundo           |
| No llega el correo de recuperación o de invitación                  | Revisa spam; si no está, el correo del sistema no está configurado: avisa al equipo técnico           |
| No aparecen los botones de IA                                       | La IA no está configurada o tu rol no la permite; pide a un administrador que la active               |
| «Se agotó el presupuesto de IA de este mes»                         | Un administrador puede ampliar el presupuesto en Configuración › Inteligencia artificial              |
| «Una de las URL no está permitida»                                  | Usa una página pública (http o https); las direcciones internas se bloquean por seguridad             |
| Una ejecución aparece como «Omitida (sin novedades)»                | No había novedades nuevas en el periodo; publícalas o desactiva esa opción                            |
| «La plantilla cambió mientras la revisabas»                         | Recarga la aprobación y revisa la versión actual antes de aprobar                                     |
| No recibo el correo de aprobación                                   | Comprueba que eres aprobador de la automatización y revisa spam; también aparece en **Aprobaciones**  |

Si el problema persiste, contacta con el equipo de desarrollo. Indica el **código de seguimiento** que muestran los errores inesperados, o el `x-trace-id` de las cabeceras de la respuesta. Ambos permiten localizar la operación en los logs.
