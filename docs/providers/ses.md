# Amazon SES (API v2)

Autor: **Ing. Heri Espinosa**

MC Send Notify envía con `SendEmail` de SES v2 en formato _raw_ (MIME completo). Recibe entregas, rebotes y quejas mediante un **Configuration Set** que publica en **SNS**, y SNS los envía por HTTPS a la plataforma, con la firma verificada.

> **Cuándo usarlo:** grandes volúmenes con buen precio y control fino de la reputación.

## 1. Verificar el dominio

1. En la consola de SES de la región elegida (por ejemplo `us-east-1`), entra en **Identities** → **Create identity** → **Domain**.
2. Activa **Easy DKIM** (RSA 2048) y publica los 3 registros CNAME que muestra.
3. Opcional: configura un **MAIL FROM personalizado** (`bounce.multicomputos.com`) para alinear SPF con DMARC. Ver la [guía DNS](dns.md).

## 2. Salir del _sandbox_

En **Account dashboard** → **Request production access**: describe el uso (comunicaciones a clientes con baja en un clic y supresión automática de rebotes y quejas) y el volumen previsto. Hasta la aprobación, SES solo envía a direcciones verificadas.

## 3. Usuario de IAM con permisos mínimos

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ses:SendEmail", "ses:SendRawEmail"],
      "Resource": "*",
      "Condition": { "StringEquals": { "ses:FromAddress": ["notificaciones@multicomputos.com"] } }
    },
    { "Effect": "Allow", "Action": ["ses:GetAccount"], "Resource": "*" }
  ]
}
```

- **Restricción del remitente:** quita la condición `ses:FromAddress` si usarás varios remitentes, o añádelos a la lista.
- **Credenciales:** crea una _access key_ para el usuario. Rótala periódicamente.

## 4. Configuration Set y SNS

1. **SNS:** crea un tema estándar, por ejemplo `mcsn-ses-events`.
2. **Configuration Set** en SES, por ejemplo `mcsn`:
   - **Event destinations** → **Add destination** → tipos **Delivery**, **Hard bounce** (_Bounce_) y **Complaint**;
   - **Destino:** el tema SNS.
3. **En MC Send Notify:**
   - crea el proveedor (siguiente apartado) y copia su **URL para eventos**: `https://<dominio>/api/webhooks/email/<token>`;
   - en SNS crea una **suscripción HTTPS** del tema a esa URL. La plataforma la confirma automáticamente al verificar la firma de SNS (solo acepta certificados de `sns.<región>.amazonaws.com`).

## 5. Configurar el proveedor

| Campo                             | Valor                                             |
| --------------------------------- | ------------------------------------------------- |
| Región                            | `us-east-1` (la del dominio verificado)           |
| Configuration Set                 | `mcsn`                                            |
| Access key ID / Secret access key | Credenciales del usuario de IAM                   |
| Envíos por segundo                | El _maximum send rate_ de la cuenta (p. ej. `14`) |
| Máximo al día                     | La cuota de 24 h de la cuenta                     |

Pulsa **Probar conexión**: comprueba las credenciales y lee la cuota de la cuenta.

## 6. Problemas frecuentes

| Síntoma                                          | Causa                                                   | Solución                                                               |
| ------------------------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------- |
| `MessageRejected: Email address is not verified` | Cuenta en _sandbox_                                     | Solicitar acceso de producción                                         |
| No llegan rebotes ni quejas                      | Suscripción SNS sin confirmar o Configuration Set vacío | Revisar la suscripción y escribir el Configuration Set en el proveedor |
| 401 en los eventos                               | Mensaje de SNS manipulado o de otra región              | Comprobar que el tema y la URL son los del proveedor                   |
| Reputación en revisión                           | Tasa de rebotes > 5 % o de quejas > 0,1 %               | Limpiar listas; la plataforma ya suprime rebotes permanentes y quejas  |
