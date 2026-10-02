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

### Elegir la aplicación

Si perteneces a varias aplicaciones, elige una en **Elige una aplicación**. Puedes cambiar en cualquier momento desde el selector situado arriba a la izquierda.

### Roles

| Rol           | Puede                                                             |
| ------------- | ----------------------------------------------------------------- |
| Propietario   | Todo, incluida la gestión de otros propietarios                   |
| Administrador | Todo salvo gestionar propietarios                                 |
| Editor        | Gestionar contactos, importaciones, listas, segmentos y etiquetas |
| Lector        | Consultar contactos, listas, segmentos y miembros                 |

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

## 6. Configuración

| Sección               | Para qué sirve                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| General               | Nombre, idioma, zona horaria y **dirección postal** (obligatoria en el pie de los correos comerciales) |
| Miembros              | Invitar personas, cambiar su rol o quitarles el acceso                                                 |
| Campos personalizados | Datos adicionales de los contactos: texto, número, fecha, sí/no o selección                            |
| Etiquetas             | Marcas libres para clasificar contactos                                                                |
| Temas de suscripción  | Tipos de comunicación que el contacto puede aceptar o rechazar, como "Resumen semanal"                 |
| Claves de API         | Integraciones de otras aplicaciones con la API de contactos                                            |
| Actividad             | Registro de quién hizo qué y cuándo                                                                    |

### Invitar a un miembro

1. En **Miembros**, pulsa **Invitar**, escribe el correo y elige el rol.
2. Copia el enlace que aparece y envíaselo a la persona. El enlace caduca en 7 días y solo se muestra una vez.
3. Al abrir el enlace:
   - si la persona no tiene cuenta, crea una contraseña de al menos 12 caracteres;
   - si ya tiene cuenta, inicia sesión con ese mismo correo y acepta.

### Crear una clave de API

1. En **Claves de API**, pulsa **Nueva clave**, ponle un nombre y elige los permisos y la caducidad.
2. **Copia la clave en ese momento.** Por seguridad, no se vuelve a mostrar.
3. Úsala desde tu aplicación con la cabecera `Authorization: Bearer <clave>` contra `/api/v1/contacts`. El README tiene un ejemplo.
4. Si la clave se expone, pulsa **Revocar**: deja de funcionar de inmediato.

## 7. Funciones próximas

| Función                                                                                    | Estado                |
| ------------------------------------------------------------------------------------------ | --------------------- |
| Plantillas y documentos (HTML, Markdown, PDF, Word, PowerPoint) con miniatura              | Próximamente (Fase 2) |
| Campañas, envíos programados, pruebas A/B, métricas de apertura y clics, bajas automáticas | Próximamente (Fase 3) |
| Envío de invitaciones por correo                                                           | Próximamente (Fase 3) |
| Redacción con IA, resúmenes semanales automáticos y aprobación antes de enviar             | Próximamente (Fase 4) |
| Instalación como aplicación (PWA)                                                          | Próximamente (Fase 5) |

## 8. Resolución de problemas

| Problema                                                            | Qué hacer                                                                              |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| "Email o contraseña incorrectos"                                    | Revisa los datos. Tras 5 intentos, espera 15 minutos                                   |
| "Tu cuenta de Microsoft no tiene acceso"                            | Tu dominio no está en la lista permitida; pide acceso a un administrador               |
| No ves una aplicación                                               | Pide a un propietario o administrador que te invite                                    |
| La página muestra 404 en una aplicación                             | No eres miembro de esa aplicación o el enlace es incorrecto                            |
| Una importación se queda "En cola"                                  | El procesador de tareas no está en marcha (`pnpm dev:worker` o el contenedor `worker`) |
| "Solo se admiten archivos CSV o XLSX válidos"                       | Guarda el archivo como CSV UTF-8 o como libro de Excel (.xlsx)                         |
| El estado muestra `database: down`, `redis: down` o `storage: down` | Ejecuta `docker compose up -d postgres redis storage` y vuelve a comprobar             |
| `pnpm setup` falla con "port is already allocated"                  | Otro proyecto usa ese puerto: cámbialo en `compose.override.yaml` y en `.env`          |
| La construcción de Docker falla con errores de certificado          | Sigue las instrucciones de `docker/certs/README.md`                                    |

Si el problema persiste, contacta con el equipo de desarrollo. Indica el **código de seguimiento** que muestran los errores inesperados, o el `x-trace-id` de las cabeceras de la respuesta. Ambos permiten localizar la operación en los logs.
