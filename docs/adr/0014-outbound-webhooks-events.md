# ADR 0014: Webhooks salientes firmados y eventos que disparan automatizaciones

- **Estado:** aceptada
- **Fecha:** 2026-10-03
- **Autor:** Ing. Heri Espinosa

## Contexto

Las aplicaciones de Multicómputos necesitan:

1. **Enterarse** de lo que pasa en MC Send Notify: campaña enviada, rebote, queja, baja, aprobación pendiente y automatización fallida, por ejemplo para marcar al cliente en su CRM.
2. **Disparar** comunicaciones cuando ocurre algo en ellas, por ejemplo «se publicó la versión 2.4», sin esperar a la programación semanal.

## Decisión

### Webhooks salientes

- **Destinos:**
  - hasta 10 por tenant (`WebhookEndpoint`), cada uno con los eventos que le interesan;
  - los gestiona OWNER/ADMIN, con el permiso `webhook:manage`.
- **Secreto:**
  - `whsec_…`, generado en el servidor y mostrado **una sola vez**;
  - se guarda cifrado con AES-256-GCM y AAD `tenant:webhook_endpoint:id`, según el [ADR 0010](0010-secrets-encryption.md);
  - se puede rotar.
- **Firma:**
  - `x-mcsn-signature: v1=<hex HMAC-SHA256(secreto, "{timestamp}.{cuerpo}")>`;
  - el timestamp va en `x-mcsn-timestamp`;
  - otras cabeceras: `x-mcsn-event`, `x-mcsn-event-id` y `x-mcsn-delivery`;
  - es el mismo esquema que usan Stripe y Svix, por lo que los receptores lo conocen.
- **Sobre:** `{ id, type, createdAt, tenant, data }`. El `id` del evento es el mismo en todos los destinos y sirve para deduplicar en el receptor.
- **Publicación (`EventPublisher`):**
  - nunca lanza;
  - un error se registra en el log y la operación de negocio continúa;
  - crea una fila `WebhookDelivery` por destino y la encola en `outbound-webhook`.
- **Entrega:**
  - `safeFetch` con protección SSRF, sin redirecciones, 10 s de tiempo máximo y respuesta de 256 KB como máximo;
  - 8 intentos con backoff exponencial (1 min → ~2 h);
  - un fallo intermedio se registra como aviso, no como error.
- **Auto-desactivación:**
  - tras 20 fallos definitivos seguidos;
  - reactivar el destino reinicia el contador.
- **Registro de entregas:** las últimas 50 se ven en la UI y se purgan a los 30 días ([ADR 0015](0015-privacy-retention-keys.md)).

### Eventos entrantes (`POST /api/v1/events`)

- **Autenticación:** clave de API con el nuevo ámbito `events:write`, que concede `automation:read` y `automation:trigger`.
- **Cuerpo:**
  - `{ event, id?, data? }`, de 16 KB como máximo;
  - `event` con el formato `release.published`.
- **Disparo:**
  - cada automatización **activa** con ese `eventKey` recibe una ejecución con la clave `event-{id}`;
  - si el emisor reintenta con el mismo `id`, no se duplican campañas: el job y la ejecución son idempotentes.
- **Fuente para la IA:** `data` se añade como fuente de texto «Evento X», como dato no confiable envuelto en `<source>`.
- **Respuesta:** `202` con las automatizaciones disparadas.

## Alternativas descartadas

- **Webhooks síncronos dentro de la transacción de negocio:** un receptor lento bloquearía envíos y bajas.
- **Patrón _outbox_ completo:** la publicación ocurre tras confirmar el cambio. Si Redis cae entre ambos pasos, se pierde el evento. Se acepta ese riesgo: los webhooks son notificaciones y el estado real se consulta en la app. El registro de entregas permite auditarlas.
- **Cron libre por evento:** YAGNI. El evento convive con la programación semanal de la automatización.

## Consecuencias

- **Nuevas tablas:** `webhook_endpoints` y `webhook_deliveries` (migración aditiva), más la columna `automations.event_key`.
- **Receptores en desarrollo:** un destino privado (`localhost`, red de Docker) solo funciona con `SSRF_ALLOW_PRIVATE=true`, y en ese caso se admite cualquier puerto.
