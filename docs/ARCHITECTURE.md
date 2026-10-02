# Arquitectura de MC Send Notify

Autor: **Ing. Heri Espinosa**

## 1. Visión general

MC Send Notify sigue una **arquitectura hexagonal (puertos y adaptadores)** dentro de un único proyecto Next.js. El mismo código de dominio e infraestructura lo usan dos procesos:

- **App web** (Next.js): interfaz, Server Actions y endpoints HTTP.
- **Worker** (Node.js + BullMQ): trabajo asíncrono como envíos, conversión de documentos, automatizaciones y mantenimiento.

```mermaid
flowchart LR
  user([Usuario]) -->|HTTPS| caddy[Caddy<br/>TLS automático]
  caddy --> app[App Next.js<br/>src/app]
  app --> pg[(PostgreSQL 18)]
  app --> redis[(Redis 8)]
  app --> s3[(SeaweedFS<br/>S3)]
  worker[Worker BullMQ<br/>src/worker] --> pg
  worker --> redis
  worker --> s3
  worker --> gotenberg[Gotenberg<br/>PPTX/DOCX→PDF]
  worker -->|SMTP / API| providers[[Proveedores de correo]]
  app -. logs warn+ .-> mclog[[MCLog]]
  worker -. logs warn+ .-> mclog
```

## 2. Capas

| Capa            | Carpeta              | Responsabilidad                                                               | Puede depender de                    |
| --------------- | -------------------- | ----------------------------------------------------------------------------- | ------------------------------------ |
| Dominio         | `src/core`           | Entidades, reglas, casos de uso y puertos (interfaces)                        | Solo `zod` y otros módulos de `core` |
| Infraestructura | `src/infrastructure` | Adaptadores de los puertos: Prisma, Redis/BullMQ, proveedores, observabilidad | `core`, `common` y librerías         |
| Worker          | `src/worker`         | Procesadores de colas, programaciones y salud del proceso                     | `core`, `infrastructure`, `common`   |
| Presentación    | `src/app`            | Rutas, layouts, Server Components, Server Actions y API                       | Todas las anteriores                 |
| UI              | `src/components`     | Componentes Atomic Design                                                     | `common`; nunca infraestructura      |
| Transversal     | `src/common`         | Configuración, tema, i18n y utilidades puras                                  | Librerías                            |

Los límites se **hacen cumplir con ESLint** (`no-restricted-imports` en [eslint.config.mjs](../eslint.config.mjs)):

- `core` no puede importar Next.js, React, MUI, Prisma, BullMQ, Redis, pino ni configuración de entorno.
- `infrastructure` y `worker` no pueden importar la presentación ni frameworks de UI.
- `components` no puede importar infraestructura.

### Composition root

[src/infrastructure/container.ts](../src/infrastructure/container.ts) crea las dependencias compartidas: logger, Prisma, Redis y comprobaciones de salud. Usa fábricas con singleton perezoso guardado en `globalThis`, para que el HMR de desarrollo no abra conexiones duplicadas. No se usa ninguna librería de inyección de dependencias: los casos de uso reciben sus puertos desde aquí.

## 3. Flujo de una petición web

```mermaid
sequenceDiagram
  participant B as Navegador
  participant P as proxy.ts
  participant L as [locale]/layout.tsx
  participant C as Server Components
  B->>P: GET /es
  P->>P: nonce CSP + x-trace-id + idioma (next-intl)
  P->>L: cabeceras x-nonce, x-trace-id, Content-Security-Policy
  L->>L: fuentes de marca, InitColorSchemeScript (con nonce), tema MUI
  L->>C: renderizado con mensajes ES/EN
  C-->>B: HTML + CSP + x-trace-id
```

- El **proxy** ([src/proxy.ts](../src/proxy.ts)) se ejecuta en todas las páginas, pero no en `/api`, `/trk` ni en los archivos estáticos.
- El **nonce** se aplica a los scripts de Next.js, al script de esquema de color de MUI y a la caché de Emotion.
- El **traceId** se propaga a los logs y, en fases posteriores, a los jobs de las colas.

## 4. Flujo del worker

```mermaid
sequenceDiagram
  participant S as Job Scheduler (BullMQ)
  participant Q as Cola maintenance
  participant W as Worker
  participant R as Redis
  participant A as App /api/health/ready
  S->>Q: job heartbeat cada 30 s
  Q->>W: processMaintenanceJob
  W->>R: SET mcsn:worker:heartbeat
  A->>R: GET mcsn:worker:heartbeat
  A-->>A: worker up si el latido tiene menos de 3 min
```

El latido prueba de extremo a extremo que Redis funciona, que el scheduler programa jobs y que el worker los procesa.

Las colas planificadas para las siguientes fases son `campaign-dispatch`, `send-{providerConfigId}`, `document-process`, `contact-import`, `automation-run`, `ai-generate`, `webhook-ingest`, `outbound-webhook`, `system-mail` y `dead-letter`. Están descritas en el plan del proyecto. BullMQ no admite `:` en los nombres de cola.

## 5. Multi-tenancy

Cada **tenant** es una aplicación o producto de Multicómputos. Desde la Fase 1 el aislamiento se aplica en tres capas:

1. Los puertos de `core` reciben un `TenantContext` explícito en cada operación.
2. Una extensión de Prisma (`prisma.forTenant(tenantId)`) inyecta el filtro `tenantId` en lecturas y escrituras y prohíbe las escrituras anidadas.
3. Un test de guardia recorre el modelo de datos y falla si una tabla con `tenantId` queda fuera de la extensión.

El `tenantId` nunca se acepta desde el cliente. Se resuelve a partir del _slug_ de la URL y de la membresía del usuario.

## 6. Diseño de la UI

- **Atomic Design:** `atoms` (por ejemplo `BrandLogo`), `molecules` (`ThemeToggle`, `LocaleSwitcher`, `FeatureCard`) y `organisms` (`PublicHeader`).
- **Tailwind y MUI conviven** mediante capas CSS (`@layer theme, base, mui, components, utilities`). Las variables CSS que genera MUI (prefijo `--mc-`) se exponen como colores de Tailwind (`bg-primary`, `text-ink-muted`...), con una sola fuente de verdad en [src/common/theme/tokens.ts](../src/common/theme/tokens.ts).
- **Modo oscuro** por clase en `<html>`, compartido por MUI y Tailwind, sin parpadeo inicial.
