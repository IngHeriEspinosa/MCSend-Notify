# ADR 0008: Pipeline de envío con cola única y límites en Redis

- **Estado:** aceptada
- **Fecha:** 2026-10-02
- **Autor:** Ing. Heri Espinosa

## Contexto

Una campaña puede tener decenas de miles de destinatarios y cada tenant usa su propio proveedor, con límites muy distintos:

- Microsoft 365: unos 30 mensajes por minuto y 10.000 al día;
- SES: 14 por segundo en una cuenta nueva;
- un SMTP propio: lo que soporte el servidor.

El envío debe sobrevivir a reinicios y caídas del worker sin enviar dos veces la misma campaña al mismo contacto. También debe poder pausarse, reanudarse y cancelarse.

El plan original proponía una cola de BullMQ por proveedor (`send:{providerConfigId}`), con el limitador nativo de cada cola.

## Decisión

### Cola única `email-send` con límites en Redis

Se usa una sola cola `email-send` (job `delivery-{deliveryId}`, 6 intentos con backoff exponencial). Antes de enviar, el caso de uso pide hueco al puerto `SendThrottle`. La implementación es `RedisSendThrottle`, compartida por todos los workers. Hay dos tipos de límite:

- **`rate` (ritmo por segundo del proveedor):** GCRA (_Generic Cell Rate Algorithm_) en un script Lua atómico que usa el reloj de Redis. Cada envío reserva el siguiente hueco (`1 s / límite`). En cualquier ventana deslizante de un segundo caben como mucho `límite + 1` envíos. El límite admite decimales: Microsoft 365 usa 0,5/s (30 por minuto), algo que un contador entero por segundo no puede expresar.
- **`quota` (cupo diario del proveedor y límite por hora de la campaña):** contador por ventana fija (`rate-limiter-flexible`).

Si no hay hueco, el job se mueve a `delayed` hasta el momento exacto del siguiente hueco (`moveToDelayed` + `DelayedError`), sin consumir intentos.

Motivos frente a las colas dinámicas por proveedor:

- **Sin registro dinámico de workers:** un worker por cola y proveedor obligaría a crear y cerrar workers al dar de alta o editar proveedores, en cada réplica.
- **Varios límites a la vez:** el limitador de BullMQ es uno por cola. Aquí se combinan el ritmo y el cupo diario del proveedor con el límite por hora de la campaña.
- **Configuración en caliente:** el límite se lee de la fila del proveedor en cada envío, sin reiniciar nada.

### Por qué GCRA y no una ventana fija

La primera versión usaba una ventana fija también para el ritmo por segundo. En la prueba de carga (5.000 destinatarios, límite de 50/s) se midieron **59 envíos en un mismo segundo de reloj**. Una ventana fija permite hasta el doble del límite en la frontera entre dos ventanas, y los proveedores (SES, Resend) miden el ritmo de forma continua: esa ráfaga provoca errores de _throttling_. Con GCRA el máximo medido en cualquier ventana deslizante de 1 s fue de 47.

### Idempotencia y exactamente-una-vez en la base de datos

1. **Despacho** (`campaign-dispatch`, job `dispatch-{campaignId}-{version}`):
   - congela el contenido compilado;
   - recorre la audiencia por cursor en lotes de 1.000;
   - crea las entregas con `INSERT ... ON CONFLICT DO NOTHING` sobre la clave única `(campaignId, contactId)`;
   - guarda el cursor. Si el worker se cae, el despacho se reanuda desde el último lote.
2. **Envío:**
   - la transición `QUEUED → SENDING` es un CAS (`updateMany where status = QUEUED`), así que solo un worker reclama cada entrega;
   - el `Message-ID` es determinista (`<deliveryId@dominio>`) y Resend recibe `Idempotency-Key`, de modo que un reintento tras una caída es detectable como duplicado por el receptor.
3. **Recuperación:** una entrega que lleva más de 10 minutos en `SENDING` (worker muerto con `SIGKILL`) vuelve a `QUEUED` y se reencola. Es el único caso de posible doble envío, inherente a cualquier sistema _at-least-once_ con un servidor SMTP externo: el proveedor aceptó el mensaje pero el worker murió antes de registrarlo.
4. **Pausa y cancelación:** antes de reclamar, el envío comprueba el estado de la campaña. Las entregas de una campaña en pausa se quedan en `QUEUED` y se reencolan al reanudar.

### Circuit breaker por proveedor

Un error `AUTH` o `CONFIG` del proveedor no se reintenta:

- el proveedor pasa a `ERROR`;
- sus campañas en envío se pausan con el motivo `PROVIDER_ERROR`.

Tras corregirlo y probar la conexión, la persona reanuda la campaña.

## Consecuencias

- Un solo `Worker` de BullMQ con concurrencia `EMAIL_SEND_CONCURRENCY` atiende a todos los proveedores. Un proveedor lento ocupa huecos de concurrencia, pero no bloquea a los demás, porque sus jobs se aplazan en lugar de esperar.
- Las estadísticas se calculan con SQL agregado sobre `deliveries` y `delivery_events` (índices por campaña y estado), en lugar de contadores en Redis volcados a una tabla. Con decenas de miles de entregas por campaña las consultas tardan milisegundos. Si se necesitara, se puede añadir una tabla de agregados sin cambiar los puertos.
- El informe se actualiza por _polling_ cada 5 s mientras la campaña está activa, en lugar de SSE. Es más simple detrás de Caddy y no mantiene conexiones abiertas.

## Verificación

- 5.000 destinatarios a Mailpit:
  - reinicio ordenado del worker (`SIGTERM`), pausa, reanudación y `SIGKILL` a mitad del envío;
  - 0 contactos duplicados en la base de datos;
  - las 15 entregas que quedaron en `SENDING` tras el `SIGKILL` se recuperaron a los 10 minutos.
- Tests de integración con Redis real:
  - ritmo uniforme (máximo de 21 en cualquier segundo con un límite de 20);
  - cupo exacto por ventana.
