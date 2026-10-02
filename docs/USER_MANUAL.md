# Manual de usuario de MC Send Notify

Autor: **Ing. Heri Espinosa**

Este manual explica cómo poner en marcha y usar MC Send Notify. Se amplía en cada fase del proyecto. Las funciones marcadas como _Próximamente_ todavía no están disponibles.

## 1. ¿Qué es MC Send Notify?

Es la plataforma de Multicómputos para enviar correos a los clientes de cada aplicación o producto:

- actualizaciones de versión;
- resúmenes semanales;
- comunicados con documentos adjuntos.

Cada aplicación (por ejemplo MCSupport o MCLog) tiene su propio espacio, con sus contactos, plantillas, remitentes y marca.

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

### En un servidor (producción)

1. Copia `.env.example` a `.env` y completa los valores.
   - Genera cada secreto con `openssl rand -base64 32`.
   - Define `APP_DOMAIN` con el dominio público.
2. Apunta el dominio al servidor y abre los puertos 80 y 443.
3. Ejecuta:

   ```bash
   docker compose -f compose.yaml -f compose.prod.yaml up -d --build
   ```

4. Comprueba `https://tu-dominio/api/health/ready`: debe responder `"status":"ok"`.

## 3. Uso básico

### Cambiar el idioma

Arriba a la derecha están los botones **ES** y **EN**. El idioma se refleja en la dirección (`/es/...` o `/en/...`) y se mantiene al navegar.

### Cambiar entre modo claro y oscuro

Pulsa el icono de luna o de sol junto al selector de idioma. Por defecto la aplicación sigue la preferencia de tu sistema operativo.

### Ver el estado de la plataforma

Pulsa **Ver estado de la plataforma** en la página de inicio, o abre `/api/health/ready`. Cada componente aparece como `up` (disponible) o `down` (caído):

- `database`
- `redis`
- `gotenberg` (conversión de documentos)
- `worker` (procesador de tareas)

## 4. Funciones

| Función                                                                                | Estado                |
| -------------------------------------------------------------------------------------- | --------------------- |
| Inicio de sesión con la cuenta de Microsoft de Multicómputos o con correo y contraseña | Próximamente (Fase 1) |
| Gestión de aplicaciones (tenants), miembros y roles                                    | Próximamente (Fase 1) |
| Contactos, listas, segmentos e importación desde CSV o Excel                           | Próximamente (Fase 1) |
| Plantillas y documentos (HTML, Markdown, PDF, Word, PowerPoint) con miniatura          | Próximamente (Fase 2) |
| Campañas, envíos programados, pruebas A/B y métricas de apertura y clics               | Próximamente (Fase 3) |
| Redacción con IA, resúmenes semanales automáticos y aprobación antes de enviar         | Próximamente (Fase 4) |
| Instalación como aplicación (PWA)                                                      | Próximamente (Fase 5) |

## 5. Resolución de problemas

| Problema                                                   | Qué hacer                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| La página no carga en http://localhost:3020                | Comprueba que `pnpm dev` está en marcha y que ningún otro programa usa el puerto 3020 |
| El estado muestra `database: down` o `redis: down`         | Ejecuta `docker compose up -d postgres redis` y vuelve a comprobar                    |
| El estado muestra `worker: down`                           | Inicia el procesador de tareas con `pnpm dev:worker`                                  |
| `pnpm setup` falla con "port is already allocated"         | Otro proyecto usa ese puerto: cámbialo en `compose.override.yaml` y en `.env`         |
| La construcción de Docker falla con errores de certificado | Sigue las instrucciones de `docker/certs/README.md`                                   |

Si el problema persiste, contacta con el equipo de desarrollo e indica el `x-trace-id` que aparece en las cabeceras de la respuesta. Permite localizar la operación en los logs.
