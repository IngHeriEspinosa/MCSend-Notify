# ADR 0012: Automatizaciones con aprobación humana

- **Estado:** aceptada
- **Fecha:** 2026-10-03
- **Autor:** Ing. Heri Espinosa

## Contexto

Cada aplicación quiere enviar un resumen periódico de novedades sin redactarlo a mano. Las novedades las publica cada producto en su buzón (`POST /api/v1/changelog`). El correo lo redacta la IA, pero un envío masivo con contenido generado no puede salir sin control humano. La aprobación debe ser segura frente a los escáneres de enlaces de los correos corporativos, que abren cada enlace que reciben.

## Decisión

### Modelo

- **Automatización:**
  - programación por _presets_ (diaria, semanal o mensual, con hora y zona horaria), traducida a cron; no se admite cron libre;
  - definición validada con Zod: fuentes, instrucciones, tono, idioma, audiencia, tema, remitente, aprobación (aprobadores, plazo y acción al caducar) y «omitir si no hay novedades».
- **Ejecución (`automation_runs`):**
  - clave de idempotencia única por automatización: el id del job programado o un id manual;
  - registra el resumen de las fuentes (sin su contenido), los enlaces eliminados, la plantilla y la campaña.
- **Aprobación (`approval_requests`):** aprobadores, caducidad, acción al caducar y decisión.
- **Campaña:** estado nuevo `PENDING_APPROVAL`, entre `DRAFT` y `SCHEDULED`.

### Ejecución

Cola `automation-run` con BullMQ Job Schedulers (cron + zona horaria). Al arrancar, el worker reprograma todas las automatizaciones activas. Pasos fijos:

1. **Reunir fuentes.** Sin novedades nuevas, la ejecución queda `SKIPPED` y no se envía nada.
2. **Redactar con IA.**
3. **Crear plantilla y campaña.** El autor es la persona que creó la automatización. Las novedades se marcan como enviadas.
4. **Aprobación o envío:**
   - con aprobación, la campaña pasa a `PENDING_APPROVAL` y se avisa por correo a los aprobadores;
   - sin aprobación, se programa sin confirmación tecleada. Solo el actor de sistema puede hacerlo; la autorización la dio quien configuró la automatización con permiso de envío.

Cada paso hecho se guarda en la ejecución, así que un reintento tras una caída continúa sin duplicar plantillas ni campañas. Los errores de dominio cierran la ejecución como `FAILED`. Los transitorios (IA no disponible u ocupada) se reintentan, tres intentos con backoff.

### Aprobación

- **Enlace del correo:** lleva a `/{locale}/t/{slug}/approvals/{id}`, que exige sesión. La decisión es una Server Action (POST), así que abrir el enlace no decide nada.
- **Quién decide:** los aprobadores designados o, en su defecto, propietarios y administradores, siempre con permiso de envío. Los aprobadores se validan al guardar la automatización.
- **Aprobar:** congela la versión de la plantilla que vio quien aprueba. Si alguien la editó después, la aprobación falla (`TEMPLATE_CHANGED`) en lugar de enviar otra cosa.
- **Rechazar:** devuelve la campaña a borrador.
- **Caducidad:** un barrido cada minuto aplica la acción configurada: cancelar (por defecto) o enviar.
- **Concurrencia:** la transición de la campaña (CAS sobre su estado) es siempre el primer paso. Si dos personas deciden a la vez, o una decide mientras caduca, quien pierde recibe un error antes de registrar su decisión. La caducidad usa una transición estrecha (`PENDING_APPROVAL → CANCELLED`) que nunca cancela una campaña ya programada.

### Diferencias con el plan

- **Sin token en el enlace de aprobación.** La sesión y la comprobación de aprobador ya autorizan, y un token secreto no añade seguridad. El correo lleva un enlace directo.
- **Sin tabla `ContentSource`.** Las fuentes forman parte de la definición (YAGNI).
- **Sin disparadores por webhook o evento** (`/api/v1/events`) **ni webhooks salientes.** Pasan a la Fase 5.

## Consecuencias

- Una campaña generada por IA nunca sale sin revisión, salvo que una persona con permiso de envío desactive la aprobación de forma explícita. La interfaz avisa de ello.
- La aprobación tiene coste humano. Por eso se avisa por correo, el menú muestra un contador de pendientes y existe la opción «enviar al caducar».
