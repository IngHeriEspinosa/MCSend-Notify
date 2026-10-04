# Despliegue de MC Send Notify

Autor: **Ing. Heri Espinosa**

Guía para publicar la plataforma en una VM con Docker y Caddy (TLS). Para el entorno de desarrollo, ver el [README](../README.md).

## 1. Topología

```mermaid
flowchart LR
  internet([Internet / red interna]) -->|80, 443| caddy[Caddy<br/>TLS]
  subgraph vm[VM · docker compose]
    caddy --> app[app :3000]
    app --> postgres[(postgres)]
    app --> redis[(redis)]
    app --> storage[(storage S3)]
    worker[worker :9464] --> postgres
    worker --> redis
    worker --> storage
    worker --> gotenberg[gotenberg]
    worker -. opcional .-> clamav[clamav]
  end
  worker -->|SMTP / API| providers[[Proveedores de correo]]
  worker -->|webhooks firmados| receivers[[Sistemas de las apps]]
```

- **Puertos:** solo Caddy publica puertos (80 y 443). La base de datos, Redis, el almacenamiento y los procesos internos no son accesibles desde fuera.
- **Usuarios:** la app y el worker se ejecutan como el usuario `node`. `migrate` aplica las migraciones antes de arrancar ambos.

## 2. Requisitos de la VM

| Recurso  | Mínimo                           | Recomendado | Notas                                                                 |
| -------- | -------------------------------- | ----------- | --------------------------------------------------------------------- |
| CPU      | 2 vCPU                           | 4 vCPU      | LibreOffice (Gotenberg) y sharp son intensivos al procesar documentos |
| RAM      | 4 GB                             | 8 GB        | +1,5 GB si se activa ClamAV                                           |
| Disco    | 40 GB SSD                        | 100 GB SSD  | Documentos y base de datos crecen con el uso                          |
| Software | Docker Engine 27+ con Compose v2 | —           | Linux x86-64                                                          |

Red:

- **Entrada:** 80 y 443 hacia la VM.
- **Salida:**
  - SMTP o HTTPS hacia los proveedores de correo;
  - HTTPS hacia Anthropic, Let's Encrypt y los receptores de webhooks;
  - con ClamAV, hacia `database.clamav.net` para descargar las firmas.

## 3. Primer despliegue

1. **Copiar el proyecto** a la VM, por ejemplo con `git clone`, en `/opt/mc-send-notify`.
2. **Crear `.env`** a partir de `.env.example`. Hay dos opciones:
   - en un equipo con Node 24, `pnpm setup` genera los secretos;
   - a mano, generando cada secreto con `openssl rand -base64 32`.

   Valores clave de producción:

   ```dotenv
   APP_ENV=production
   APP_DOMAIN=mcsend.multicomputos.com
   APP_URL=https://mcsend.multicomputos.com
   CADDY_TLS=acme                # internal si la VM no es accesible desde Internet
   SSRF_ALLOW_PRIVATE=false      # nunca true en producción
   SYSTEM_MAIL_SMTP_URL=smtps://usuario:clave@smtp.office365.com:465
   SYSTEM_MAIL_FROM=MC Send Notify <noreply@multicomputos.com>
   ```

3. **DNS:** crear un registro `A` (o `AAAA`) de `APP_DOMAIN` hacia la IP pública de la VM, necesario con `CADDY_TLS=acme`.
4. **Arrancar:**

   ```bash
   docker compose -f compose.yaml -f compose.prod.yaml up -d --build --wait
   ```

5. **Datos iniciales.** El seed es idempotente y crea:
   - el super-administrador, con `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD`;
   - los tenants de ejemplo.

   ```bash
   docker compose -f compose.yaml -f compose.prod.yaml --profile seed run --rm seed
   ```

6. **Comprobar:**

   ```bash
   docker compose -f compose.yaml -f compose.prod.yaml ps          # todos healthy
   curl -fsS https://$APP_DOMAIN/api/health/ready                 # {"status":"up",...}
   ```

7. **Configurar la plataforma:** entrar como super-administrador, cambiar la contraseña inicial, crear las aplicaciones (tenants) y seguir el asistente de cada una: marca, proveedor, remitente, IA y contactos.

### Antivirus (opcional)

```bash
# En .env:
CLAMAV_HOST=clamav
docker compose -f compose.yaml -f compose.prod.yaml --profile security up -d --wait
```

- **Primer arranque:** ClamAV descarga sus firmas, lo que tarda varios minutos. Mientras no esté _healthy_, los documentos quedan en cola y se reintentan.
- **Desactivar:** basta con vaciar `CLAMAV_HOST`.

### Dominios de seguimiento de las aplicaciones

Cada aplicación puede usar su propio dominio en los enlaces de los correos ([ADR 0016](adr/0016-tracking-domains.md)). No hay que tocar Caddy: el `Caddyfile` ya incluye el TLS bajo demanda.

1. La aplicación crea en su DNS un **CNAME** de un subdominio (por ejemplo `clic.mcsupport.com`) hacia `APP_DOMAIN`.
2. En **Configuración › General › Dominio de seguimiento**, guarda el dominio y pulsa **Verificar**.
3. Al primer acceso, Caddy pide el certificado tras confirmar con la app (`/api/tls/allowed`) que el dominio está verificado.

Requisitos:

- con `CADDY_TLS=acme`, el **puerto 80** debe estar abierto, porque Let's Encrypt valida cada dominio por HTTP;
- con `CADDY_TLS=internal`, los equipos deben confiar en la CA de Caddy, como en el dominio principal.

## 4. TLS interno (red corporativa o pruebas)

Con `CADDY_TLS=internal`, Caddy firma el certificado con su propia CA local en lugar de Let's Encrypt. Sirve para una VM sin acceso desde Internet y para validar el despliegue en un equipo de desarrollo:

```bash
# .env de pruebas (o --env-file con otro archivo)
APP_DOMAIN=mcsend.localhost
APP_URL=https://mcsend.localhost
CADDY_TLS=internal

docker compose -p mcsn-prod -f compose.yaml -f compose.prod.yaml up -d --build --wait
docker compose -p mcsn-prod -f compose.yaml -f compose.prod.yaml --profile seed run --rm seed
```

- **Proyecto aparte:** `-p mcsn-prod` crea contenedores y volúmenes independientes de los de desarrollo.
- **Confiar en la CA:** para que los navegadores confíen en el certificado, exportar la CA raíz de Caddy e instalarla en el almacén de certificados de los equipos (en Windows, «Entidades de certificación raíz de confianza»):

  ```bash
  docker compose -p mcsn-prod -f compose.yaml -f compose.prod.yaml cp \
    caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
  ```

- **Nombres `*.localhost`:** los navegadores modernos los resuelven a `127.0.0.1`. Desde la línea de comandos: `curl --resolve mcsend.localhost:443:127.0.0.1 --cacert caddy-root.crt https://mcsend.localhost/api/health`. En Windows, el `curl` de Git (Schannel) no siempre respeta `--cacert`; en ese caso verifica con Node (`https.request` con la opción `ca`).
- **Pruebas E2E contra este despliegue.** El service worker exige un certificado de confianza. Sin instalar la CA en el sistema, se puede indicar a Chrome que confíe en el certificado del sitio mediante su huella SPKI. Caddy renueva el certificado cada 12 h, así que hay que calcularla justo antes de las pruebas:

  ```bash
  SPKI=$(echo | openssl s_client -connect 127.0.0.1:443 -servername mcsend.localhost 2>/dev/null \
    | openssl x509 -pubkey -noout | openssl pkey -pubin -outform der \
    | openssl dgst -sha256 -binary | openssl base64)
  E2E_BASE_URL=https://mcsend.localhost E2E_TRUSTED_SPKI="$SPKI" \
    E2E_EMAIL=<admin> E2E_PASSWORD=<contraseña> pnpm test:e2e
  ```

## 5. Actualizaciones

```bash
git pull
docker compose -f compose.yaml -f compose.prod.yaml up -d --build --wait
```

- **Migraciones:** `migrate` las aplica antes de arrancar la app y el worker. Todas las migraciones del proyecto son aditivas.
- **Trabajos en curso:** el worker se detiene de forma ordenada con SIGTERM. Las entregas interrumpidas se recuperan solas.
- **Service worker:** los navegadores reciben la versión nueva en la siguiente visita.

## 6. Copias de seguridad

| Qué                               | Cómo                                                                                       | Frecuencia               |
| --------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------ |
| PostgreSQL                        | `docker compose exec -T postgres pg_dump -U $POSTGRES_USER -Fc $POSTGRES_DB > backup.dump` | Diaria (retener 30 días) |
| Archivos (volumen `storage-data`) | Copia del volumen o `rclone` desde el endpoint S3                                          | Diaria                   |
| `.env`                            | Gestor de secretos de la organización                                                      | Cada cambio              |

- **Lo más crítico:** `ENCRYPTION_KEYS`. Sin esa clave no se pueden descifrar las credenciales de los proveedores, las claves de IA ni los secretos de los webhooks.
- **Redis:** guarda colas y contadores; se puede perder sin pérdida de datos de negocio. Las programaciones se recrean al arrancar el worker.

## 7. Operación

- **Logs:** `docker compose logs -f app worker`, en JSON con `traceId`. Con `MCLOG_URL` y `MCLOG_API_KEY`, los avisos y errores llegan a MCLog.
- **Colas:** **Administración › Colas** muestra los contadores y los trabajos fallidos (reintentar o descartar).
- **Uso de IA:** **Administración › Uso de IA** muestra el gasto del mes por aplicación.
- **Rotar la clave de cifrado:**
  1. Añadir la clave nueva a `ENCRYPTION_KEYS` y apuntar `ENCRYPTION_ACTIVE_KEY_ID` a ella.
  2. Reiniciar con `up -d`.
  3. Ejecutar la rotación (ver [ADR 0010](adr/0010-secrets-encryption.md)):

     ```bash
     docker compose -f compose.yaml -f compose.prod.yaml run --rm worker node dist/worker/rotate-secrets.mjs          # simulación
     docker compose -f compose.yaml -f compose.prod.yaml run --rm worker node dist/worker/rotate-secrets.mjs --apply  # recifrado
     ```

  4. Retirar la clave antigua cuando la simulación indique 0 pendientes.
- **Retención:** el worker purga cada día a las 03:30 UTC los datos de actividad antiguos (ver [ADR 0015](adr/0015-privacy-retention-keys.md)).

## 8. Verificación realizada (Fase 5)

Despliegue local con `CADDY_TLS=internal`, `APP_DOMAIN=mcsend.localhost` y un proyecto Compose separado (`mcsn-prod`). Los resultados están en la sección 20 del plan y en el resumen de la fase. Se comprobó:

- TLS con la CA interna de Caddy;
- redirección HTTP→HTTPS;
- cabeceras de seguridad;
- que solo Caddy publica puertos;
- los _healthchecks_;
- el seed;
- la suite E2E contra `https://mcsend.localhost`.
