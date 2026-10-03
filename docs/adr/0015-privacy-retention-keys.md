# ADR 0015: Privacidad (RGPD), retención de datos, rotación de claves y antivirus

- **Estado:** aceptada
- **Fecha:** 2026-10-03
- **Autor:** Ing. Heri Espinosa

## Contexto

La plataforma guarda datos personales de clientes de varias aplicaciones: emails, aperturas y clics. Además guarda secretos: credenciales de proveedores, claves de IA y secretos de webhooks. Hacían falta:

- el derecho de supresión;
- un límite de conservación;
- un procedimiento automático para rotar la clave de cifrado;
- una defensa adicional para los archivos que suben los usuarios.

## Decisión

### Derecho de supresión

- El botón **Eliminar** de la ficha del contacto (permiso `contact:delete`) usa `EraseContactUseCase`. En una transacción:
  - borra el contacto, con sus listas, etiquetas y suscripciones (cascada);
  - anonimiza el email de sus entregas a `erased-{deliveryId}@erased.invalid` (dominio reservado, RFC 2606);
  - borra el agente de usuario de sus eventos.
- Las estadísticas de las campañas se mantienen sin datos personales.
- Si el email está en la **lista de supresión**, se conserva. Es el mínimo imprescindible para no volver a escribirle si alguien lo importa de nuevo (interés legítimo, art. 17.3 RGPD) y se documenta en el diálogo de confirmación.
- La auditoría registra `contact.erased` solo con el id y el número de entregas anonimizadas.

### Retención

Purga diaria a las 03:30 UTC (job de mantenimiento `retention-sweep`). Borra por lotes de 5 000 filas (`DELETE … WHERE ctid IN (SELECT … LIMIT)`) para no bloquear tablas grandes.

| Tabla                    | Conservación        | Motivo                                          |
| ------------------------ | ------------------- | ----------------------------------------------- |
| `delivery_events`        | 396 días (13 meses) | Comparativas interanuales                       |
| `ai_usage`               | 396 días            | Costes e informes anuales                       |
| `inbound_webhook_events` | 90 días             | Cargas crudas de proveedores (contienen emails) |
| `webhook_deliveries`     | 30 días             | Depuración de integraciones                     |

La auditoría (`audit_logs`) es inmutable y no se purga. La plataforma no puede borrarla: un trigger impide UPDATE y DELETE.

### Rotación de la clave de cifrado

- **Comando:** `pnpm secrets:rotate`, o `node dist/worker/rotate-secrets.mjs` en Docker. Simula por defecto y recifra con `--apply`.
- **Alcance:** recorre `email_provider_configs.credentials_enc`, `ai_settings.credentials_enc` y `webhook_endpoints.secret_enc`.
- **Escritura condicional** (`WHERE id AND valor = leído`): no pisa una edición simultánea.
- **Filas ilegibles:** las que tienen la clave retirada o el AAD incorrecto se listan y salen con código 2. Hay que volver a introducir esas credenciales.

### Antivirus opcional

- **Activación:** `CLAMAV_HOST` y el perfil `security` de Compose (`clamav/clamav:1.4`).
- **Análisis:** cada documento se analiza con `INSTREAM` antes de convertirlo.
- **Malware:**
  - se borra el original;
  - el documento queda `FAILED` con `MALWARE_DETECTED`, sin reintentos;
  - se audita con la firma.
- **Antivirus caído:** el documento **no** se da por limpio (`SCAN_UNAVAILABLE`) y la cola reintenta.
- **Sin ClamAV**, siguen activas:
  - la lista blanca por bytes mágicos;
  - Gotenberg sin JavaScript ni red;
  - los límites de tamaño.

## Consecuencias

- La supresión no es reversible y no hay papelera. El diálogo lo explica.
- La retención borra datos de actividad antiguos de los informes. Las métricas agregadas de las campañas, que se calculan sobre `deliveries`, se conservan.
- ClamAV necesita unos 1,5 GB de RAM y descarga sus firmas al arrancar (varios minutos). Por eso es opcional.
