# SMTP

Autor: **Ing. Heri Espinosa**

MC Send Notify envía con nodemailer, con un _pool_ de conexiones reutilizado por proveedor. Antes de conectar, resuelve el host y comprueba que no es una dirección privada, de _link-local_ ni de metadatos (protección SSRF), y conecta a la IP ya validada.

> **Cuándo usarlo:** un servidor propio o un relé corporativo, con volúmenes bajos. SMTP no notifica entregas, rebotes ni quejas: solo hay seguimiento propio (aperturas, clics, descargas y bajas).

## Configuración

| Campo                | Valor habitual                                                |
| -------------------- | ------------------------------------------------------------- |
| Servidor             | `smtp.ejemplo.com`                                            |
| Puerto               | `587` con STARTTLS, `465` con TLS implícito                   |
| Seguridad            | `STARTTLS` o `TLS`. `Ninguna` solo en desarrollo, con Mailpit |
| Usuario / contraseña | Cuenta de envío (déjalos vacíos si el relé autentica por IP)  |
| Envíos por segundo   | El límite del servidor (si no lo conoces, empieza por `1`)    |

Ejemplos:

| Servicio                  | Servidor                         | Puerto | Seguridad                                                                                                                  |
| ------------------------- | -------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| Microsoft 365 (SMTP AUTH) | `smtp.office365.com`             | 587    | STARTTLS. Requiere SMTP AUTH habilitado en el buzón; para nuevas integraciones se recomienda el [proveedor Graph](m365.md) |
| Google Workspace (relé)   | `smtp-relay.gmail.com`           | 587    | STARTTLS                                                                                                                   |
| Mailpit (desarrollo)      | `mailpit` (Docker) o `localhost` | 1025   | Ninguna, con `SSRF_ALLOW_PRIVATE=true`                                                                                     |

## Problemas frecuentes

| Síntoma               | Causa                                                       | Solución                                                                      |
| --------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| «Host bloqueado»      | El servidor resuelve a una IP privada                       | En producción, usar un host público. En desarrollo, `SSRF_ALLOW_PRIVATE=true` |
| `AUTH`                | Usuario o contraseña incorrectos, o SMTP AUTH deshabilitado | Revisar las credenciales y la política del servidor                           |
| Certificado no válido | El servidor presenta un certificado de otra entidad         | Usar el nombre exacto del certificado como host                               |
