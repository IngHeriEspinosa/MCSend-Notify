# Resend

Autor: **Ing. Heri Espinosa**

MC Send Notify envía con `POST https://api.resend.com/emails`. Usa `Idempotency-Key` por entrega, de modo que un reintento no duplica el correo. Recibe los eventos por webhooks firmados con Svix.

> **Cuándo usarlo:** envíos masivos con una configuración sencilla e informes de entrega, rebotes y quejas.

## 1. Dominio

1. En [resend.com/domains](https://resend.com/domains) añade el dominio, por ejemplo `multicomputos.com` o un subdominio dedicado como `mail.multicomputos.com`.
2. Publica los registros que muestra: MX y TXT de SPF para el subdominio de retorno, y TXT de DKIM.
3. Espera a que el dominio aparezca como **Verified**.

## 2. Clave de API

**API Keys** → **Create API key**, con permiso **Sending access** limitado a ese dominio. Copia la clave `re_…`.

## 3. Webhook de eventos

1. **En MC Send Notify:** crea el proveedor (siguiente apartado) y copia su **URL para eventos**.
2. **En Resend:** **Webhooks** → **Add endpoint**, con esa URL y los eventos `email.delivered`, `email.bounced` y `email.complained`.
3. **Secreto:** copia el **Signing secret** (`whsec_…`) y pégalo en el proveedor.

La plataforma verifica la firma Svix con una tolerancia de 5 minutos y deduplica los reintentos por id de evento.

## 4. Configurar el proveedor

| Campo               | Valor                                                        |
| ------------------- | ------------------------------------------------------------ |
| Clave de API        | `re_…`                                                       |
| Secreto del webhook | `whsec_…` (para los eventos)                                 |
| Envíos por segundo  | `2` en el plan gratuito; el límite de tu plan en los de pago |
| Máximo al día       | El límite diario del plan                                    |

## 5. Problemas frecuentes

| Síntoma                        | Causa                                     | Solución                            |
| ------------------------------ | ----------------------------------------- | ----------------------------------- |
| 401 en los eventos             | Secreto distinto del del webhook          | Copiar de nuevo el _Signing secret_ |
| `validation_error` del dominio | El remitente no es del dominio verificado | Usar un remitente de ese dominio    |
| 429                            | Se superó el ritmo del plan               | Bajar **Envíos por segundo**        |
