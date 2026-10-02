# ADR 0009: Seguimiento propio, baja en un clic (RFC 8058) y webhooks de proveedores

- **Estado:** aceptada
- **Fecha:** 2026-10-02
- **Autor:** Ing. Heri Espinosa

## Contexto

El informe de una campaña debe mostrar aperturas, clics, descargas de documentos y bajas sea cual sea el proveedor. SMTP y Microsoft 365 no informan de ningún evento.

Desde 2024, Gmail y Yahoo exigen a los remitentes masivos dos cabeceras: `List-Unsubscribe` y `List-Unsubscribe-Post`. La baja debe aplicarse con un solo POST, sin pedir confirmación. Resend y SES sí notifican entregas, rebotes y quejas por webhook. Esos eventos deben suprimir la dirección para proteger la reputación del remitente.

## Decisión

### URL de seguimiento firmadas

`HmacTrackingLinks` firma la carga `{p, t, d, l?}` (propósito, tenant, entrega y enlace) con HMAC-SHA256 truncado a 16 bytes. El dominio de firma es `mcsn-track-v1`, distinto del de las URL públicas de la Fase 2, así que una firma no sirve para otro propósito. La verificación es en tiempo constante, y un token manipulado o de otro propósito devuelve 404.

| Ruta                  | Propósito | Comportamiento                                                                                                   |
| --------------------- | --------- | ---------------------------------------------------------------------------------------------------------------- |
| `GET /trk/o/{token}`  | Apertura  | GIF de 1×1 con `no-store`. Las aperturas automáticas (Apple Mail Privacy Protection, proxies) se cuentan aparte. |
| `GET /trk/c/{token}`  | Clic      | 302 a la URL **guardada en `campaign_links`**, nunca a una URL de la petición (sin redirección abierta).         |
| `HEAD /trk/c/{token}` | Clic      | Se registra como escáner y no cuenta.                                                                            |
| `GET /trk/u/{token}`  | Baja      | 303 al centro de preferencias (`/{locale}/preferences/{token}`), donde la persona confirma o elige temas.        |
| `POST /trk/u/{token}` | Baja      | Baja inmediata (RFC 8058 _one-click_): suprime solo el tema de la campaña o, si no tiene tema, todo el tenant.   |

Detalles:

- **Clics:**
  - un clic implica apertura, porque muchos clientes bloquean las imágenes;
  - los escáneres de enlaces (Microsoft Safe Links, Proofpoint, Mimecast…) se marcan con `isBot` y no cuentan;
  - un enlace a `/trk/d` (descarga de documento) registra también `DOWNLOADED`.
- **Privacidad:** la IP se guarda como HMAC diario truncado, sin la dirección real.
- **Reescritura de enlaces:** al programar la campaña se reescriben los enlaces una sola vez. Cada URL distinta se guarda en `campaign_links` con su posición y el HTML compilado usa variables Liquid (`{{ tracking.links.l3 }}`, `{{ tracking.open_url }}`), que se personalizan por destinatario.
- **Sin seguimiento cuando procede:** los envíos de prueba no llevan seguimiento. Las aperturas y los clics se pueden desactivar por campaña.

### Cabeceras de baja

Todo correo de campaña lleva estas cabeceras:

- `List-Unsubscribe: <https://…/trk/u/{token}>`;
- `List-Unsubscribe-Post: List-Unsubscribe=One-Click`;
- `Message-ID` determinista;
- `X-MCSN-Delivery`.

El pie del correo enlaza al centro de preferencias con la misma URL.

### Webhooks entrantes

Cada proveedor tiene una URL propia, `/api/webhooks/email/{endpointToken}`, con un token aleatorio de 128 bits que no revela el tenant.

- **Resend (Svix):**
  - HMAC-SHA256 de `{svix-id}.{svix-timestamp}.{cuerpo}`, con el secreto `whsec_` cifrado junto a las credenciales;
  - tolerancia de 5 minutos contra _replay_ y comparación en tiempo constante.
- **Amazon SES (SNS):**
  - firma RSA (versión 1 SHA1 o 2 SHA256) del mensaje canónico;
  - el certificado solo se descarga si su URL es `https://sns.{región}.amazonaws.com`, lo que evita SSRF y certificados falsos;
  - la confirmación de la suscripción valida el mismo host.
- **Flujo:**
  1. verificar la firma;
  2. insertar en `inbound_webhook_events`, con clave única `(providerConfigId, providerEventId)`: un reenvío del proveedor no duplica nada;
  3. encolar en `provider-events` y responder 200 de inmediato.
- **Aplicación del evento:** las transiciones de estado son monótonas, así que un `DELIVERED` tardío no deshace un `BOUNCED`.
  - Un rebote permanente o una queja crea una `suppression` (`HARD_BOUNCE` o `COMPLAINT`).
  - Un rebote temporal solo se registra como evento.

Una firma inválida devuelve 401 y un token desconocido, 404.

## Consecuencias

- Las métricas de apertura son orientativas. La interfaz muestra las personas únicas y, aparte, cuántas aperturas automáticas se excluyeron.
- SMTP y Microsoft 365 no reciben rebotes por webhook: solo se detectan los rechazos síncronos (`INVALID_RECIPIENT`). Procesar los rebotes asíncronos por IMAP queda fuera del alcance.
- El dominio de seguimiento es el de la app (`APP_URL`). Un dominio de seguimiento por tenant es una mejora futura.

## Verificación

E2E contra las imágenes de producción:

- el píxel devuelve un GIF `no-store`;
- los clics devuelven 302 a la URL guardada y a la descarga del documento;
- un token manipulado devuelve 404;
- el GET de baja devuelve 303 al centro de preferencias y el POST _one-click_ devuelve 200 y crea la supresión;
- los webhooks firmados de entrega, rebote y queja aplican sus estados y supresiones; el _replay_ se deduplica y una firma falsa devuelve 401.
