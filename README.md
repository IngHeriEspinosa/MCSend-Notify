# MC Send Notify

Gestor multi-tenant de envío automático de correos para **Multicómputos**. Cada aplicación o producto (MCSupport, MCLog, etc.) es un _tenant_ aislado con sus propios contactos, plantillas, remitentes, marca y proveedores. La plataforma permite enviar actualizaciones y resúmenes semanales a los clientes, redactarlos con IA, adjuntar documentos con miniatura y automatizar los envíos recurrentes.

> **Estado:** Fases 0, 1, 2 y 3 completadas. Ya se pueden gestionar aplicaciones (tenants), usuarios con roles, contactos, listas, segmentos, plantillas, documentos con miniatura y la marca de los correos. También se pueden configurar proveedores de correo y remitentes, y enviar campañas con seguimiento, bajas en un clic e informes. Las siguientes fases están en el [roadmap](#roadmap).

## Funcionalidades disponibles

- **Multi-aplicación:** cada producto es un tenant aislado en la capa de datos; un usuario puede pertenecer a varios con roles distintos.
- **Acceso:** inicio de sesión con email y contraseña (argon2id, bloqueo por intentos) y, opcionalmente, con Microsoft Entra ID.
- **Roles:** Propietario, Administrador, Editor y Lector, con invitaciones por enlace de un solo uso.
- **Contactos:** alta manual, campos personalizados (texto, número, fecha, sí/no, selección), etiquetas, temas de suscripción y consentimiento.
- **Importación:** archivos CSV o Excel de hasta 100.000 filas, con mapeo de columnas sugerido, deduplicación e informe de errores.
- **Listas y segmentos:** listas estáticas y segmentos dinámicos con reglas anidadas y recuento en vivo.
- **API pública:** `/api/v1/contacts` con claves de API por tenant para sincronizar contactos desde otras aplicaciones.
- **Plantillas de correo:** editor por bloques (titulares, texto, botones, imágenes, dos columnas y documentos), Markdown o HTML propio. Incluye variables `{{ contact.first_name }}`, vista previa en escritorio y móvil, modo claro y oscuro, comprobaciones previas al envío e historial de versiones con restauración.
- **Documentos:** PDF, PowerPoint, Word, Excel, OpenDocument, imágenes, HTML, Markdown y texto. Se convierten a PDF y se genera la miniatura de la primera página para mostrarla en el correo con un enlace de descarga.
- **Marca de los correos:** logotipo, colores con validación de contraste WCAG AA y pie propio por aplicación.
- **Proveedores de correo por aplicación:**
  - SMTP, Microsoft 365 (Graph), Resend y Amazon SES;
  - credenciales cifradas con AES-256-GCM, prueba de conexión y límites por segundo y por día.
- **Remitentes** con comprobación DNS de SPF, DKIM y DMARC.
- **Campañas:**
  - asistente de 5 pasos: contenido, audiencia con recuento en vivo, envío, revisión con envío de prueba y programación;
  - prueba A/B de asunto;
  - pausa, reanudación y cancelación.
- **Envío fiable:**
  - cola en el worker con ritmo uniforme por proveedor (GCRA en Redis), reintentos con backoff y _circuit breaker_;
  - un solo correo por contacto aunque el worker se reinicie.
- **Seguimiento y bajas:**
  - aperturas (sin contar las automáticas), clics, descargas de documentos y bajas;
  - `List-Unsubscribe` con baja en un clic (RFC 8058) y centro de preferencias por tema.
- **Rebotes y quejas** por webhooks firmados de Resend y SES, con supresión automática.
- **Informes** por campaña (métricas, enlaces, variantes A/B y entregas) y panel con la actividad de 30 días.
- **Correo del sistema:** invitaciones y recuperación de contraseña por correo.
- **Auditoría:** registro inmutable de las acciones de cada tenant.

## Stack

| Capa           | Tecnología                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| Web            | Next.js 16 (App Router, Server Components, `proxy.ts`), React 19, TypeScript estricto                    |
| UI             | Tailwind CSS 4 (layout y utilidades) y MUI 9 (componentes complejos), Atomic Design, modo claro y oscuro |
| i18n           | next-intl 4 (español e inglés)                                                                           |
| Datos          | PostgreSQL 18 y Prisma 7 (driver adapter `pg`)                                                           |
| Colas          | Redis 8 y BullMQ 6, con el worker en un proceso propio                                                   |
| Archivos       | Almacenamiento S3 compatible (SeaweedFS)                                                                 |
| Documentos     | Gotenberg 8 (conversión a PDF), poppler (páginas, miniatura y texto) y sharp (imágenes)                  |
| Correos        | LiquidJS (variables), markdown-it, sanitize-html y juice (CSS en línea)                                  |
| Envío          | nodemailer (SMTP), Microsoft Graph y Resend por `fetch`, `@aws-sdk/client-sesv2`, MUI X Charts           |
| Observabilidad | pino (logs JSON con redacción), MCLog opcional y endpoints de salud                                      |
| Calidad        | Vitest 5, ESLint 9 con límites de capas, Prettier                                                        |
| Despliegue     | Docker Compose en VM y Caddy con TLS automático                                                          |

## Requisitos

- Node.js 24 o superior
- pnpm 11 o superior
- Docker Desktop o Docker Engine con Compose v2

## Instalación rápida (desarrollo)

```bash
pnpm install
pnpm setup        # crea o completa .env con secretos aleatorios, levanta la infraestructura, migra y carga datos
pnpm dev          # app en http://localhost:3020
pnpm dev:worker   # worker en otra terminal, salud en http://localhost:9464/health
```

`pnpm setup` es idempotente: se puede repetir sin perder datos ni regenerar secretos.

El procesamiento de documentos necesita poppler. En Windows, ejecuta el worker en Docker con `docker compose up -d --build worker` en lugar de `pnpm dev:worker`, o instala poppler e indica su carpeta en `POPPLER_BIN_DIR`.

El acceso inicial es la cuenta `SEED_ADMIN_EMAIL` con la contraseña `SEED_ADMIN_PASSWORD` de tu archivo `.env` (generada por `pnpm setup`). Los datos de ejemplo están en la aplicación **MCSupport**.

El seed crea también el proveedor SMTP **Mailpit (desarrollo)**, el remitente por defecto y la campaña en borrador «Lanzamiento MCSupport 3.2». Todos los correos de desarrollo (campañas, pruebas, invitaciones y recuperación de contraseña) llegan a Mailpit, en http://localhost:8025. En desarrollo, `SSRF_ALLOW_PRIVATE=true` permite usar ese SMTP de la red de Docker; en producción debe quedar en `false`.

### API de contactos

```bash
curl -X POST http://localhost:3020/api/v1/contacts   -H "Authorization: Bearer mcsn_xxxxxxxx_..."   -H "Content-Type: application/json"   -d '{"email":"cliente@empresa.com","firstName":"Ana","attributes":{"plan":"Enterprise"}}'
```

La clave se crea en **Configuración → Claves de API** y solo se muestra una vez. La respuesta es `201` si el contacto es nuevo y `200` si se actualizó.

### Servicios de desarrollo

| Servicio                    | URL o puerto (solo 127.0.0.1)                                              |
| --------------------------- | -------------------------------------------------------------------------- |
| App                         | http://localhost:3020                                                      |
| Estado de dependencias      | http://localhost:3020/api/health/ready                                     |
| Worker                      | http://localhost:9464/health                                               |
| Mailpit (correos de prueba) | http://localhost:8025 (SMTP en 1025)                                       |
| PostgreSQL                  | 5452 (tests: 5453 con `docker compose --profile test up -d postgres-test`) |
| Redis                       | 6390                                                                       |
| S3 (SeaweedFS)              | http://localhost:8333                                                      |
| Gotenberg                   | http://localhost:3100                                                      |

### Stack completo en Docker

```bash
docker compose up --build          # desarrollo: app, worker e infraestructura
docker compose -f compose.yaml -f compose.prod.yaml up -d --build   # producción con Caddy y TLS
```

En redes con inspección TLS, como la red corporativa de Multicómputos, coloca la CA raíz en `docker/certs/`. Las instrucciones están en [docker/certs/README.md](docker/certs/README.md).

## Scripts

| Script                                                    | Uso                                                                     |
| --------------------------------------------------------- | ----------------------------------------------------------------------- |
| `pnpm setup`                                              | Puesta en marcha completa del entorno de desarrollo                     |
| `pnpm dev` / `pnpm dev:worker`                            | App y worker en modo desarrollo                                         |
| `pnpm build`                                              | Cliente Prisma, build de Next.js y bundle del worker                    |
| `pnpm start` / `pnpm start:worker`                        | Ejecutar el build de producción                                         |
| `pnpm db:migrate` / `db:deploy` / `db:seed` / `db:studio` | Base de datos                                                           |
| `pnpm typecheck` / `pnpm lint` / `pnpm format`            | Calidad de código                                                       |
| `pnpm test` / `test:int` / `test:coverage`                | Tests unitarios, de integración (requieren `postgres-test`) y cobertura |
| `pnpm audit`                                              | Auditoría de dependencias (falla con High o Critical)                   |

## Estructura

```
src/
├─ core/            dominio: entidades, casos de uso y puertos (sin frameworks)
├─ infrastructure/  adaptadores: Prisma, Redis/BullMQ, observabilidad, proveedores
├─ worker/          proceso de colas (BullMQ) y servidor de salud
├─ app/             rutas de Next.js (presentación) y endpoints de API
├─ components/      UI con Atomic Design (atoms, molecules, organisms)
└─ common/          configuración, tema, i18n y utilidades transversales
```

## Documentación

- [Arquitectura](docs/ARCHITECTURE.md): capas, flujos y diagramas.
- [Documento técnico](docs/TECHNICAL.md): decisiones, variables de entorno, datos, seguridad y escalabilidad.
- [Manual de usuario](docs/USER_MANUAL.md): guía de uso y resolución de problemas.
- [Decisiones de arquitectura (ADR)](docs/adr/).

## Roadmap

| Fase | Alcance                                                                                           | Estado     |
| ---- | ------------------------------------------------------------------------------------------------- | ---------- |
| 0    | Andamiaje, Docker, Prisma, observabilidad, tema de marca, i18n, worker                            | Completada |
| 1    | Núcleo multi-tenant, autenticación (Entra ID y credenciales), RBAC, contactos, listas y segmentos | Completada |
| 2    | Plantillas, documentos (HTML, MD, PDF, DOCX, PPTX) y miniaturas                                   | Completada |
| 3    | Campañas, envío multi-proveedor (SMTP, Graph, Resend, SES), tracking y bajas                      | Completada |
| 4    | IA (borradores, asuntos, traducción, segmentos) y automatizaciones con aprobación                 | Pendiente  |
| 5    | PWA, revisión i18n, hardening y documentación final                                               | Pendiente  |

## Licencia

Este proyecto es software libre distribuido bajo la [GNU General Public License v3.0](LICENSE) (`GPL-3.0-only`). Cualquier obra derivada que se distribuya debe publicarse bajo la misma licencia.

---

Desarrollado por **Ing. Heri Espinosa** para Multicómputos.
