# ADR 0016: Dominio de seguimiento propio por aplicación

- **Estado:** aceptada
- **Fecha:** 2026-10-04
- **Autor:** Ing. Heri Espinosa

## Contexto

Todos los enlaces de los correos (píxel de apertura, clics, baja, miniaturas, descargas y logotipo) apuntaban al dominio de la plataforma. Para el destinatario, un correo de MCSupport con enlaces a otro dominio genera desconfianza. Algunos filtros, además, penalizan que el dominio de los enlaces no se parezca al del remitente.

Decisiones del usuario:

- **Verificación:** solo por CNAME.
- **Centro de preferencias:** se queda en la plataforma.

## Decisión

### Configuración y verificación

- **Configuración:** OWNER/ADMIN indican un subdominio en **Configuración › General**, por ejemplo `clic.mcsupport.com`. Se guarda normalizado (minúsculas, sin punto final) en `tenants.tracking_domain`, que es **único**.
- **Validación:**
  - nombre de host público;
  - sin IP, `localhost` ni `*.local`;
  - nunca el dominio de la plataforma ni uno de sus subdominios.
- **Verificación:** el dominio debe tener un **CNAME hacia el host de `APP_URL`**. Ese registro prueba el control del DNS y además dirige el tráfico.
  - Se comprueba al guardar, con el botón **Verificar** y cada día a las 04:00 UTC (job de mantenimiento `tracking-domains-verify`).
  - Si el CNAME desaparece, se retira la verificación y los correos nuevos vuelven al dominio de la plataforma.

### Enlaces

- **Directorio en memoria:** `TrackingHostDirectory` guarda una instantánea de los dominios verificados, que se refresca cada minuto, tras cada cambio y al arrancar el worker. Con ella `HmacTrackingLinks` y `HmacPublicAssetLinks` eligen la URL base de cada tenant.
- **Puertos sin cambios:** los puertos del core (`TrackingLinks` y `PublicAssetLinks`) no cambian.
- **Tokens:** la firma HMAC no incluye el host, así que un token vale en cualquier dominio. Los correos ya enviados conservan sus enlaces.
- **Descargas:** cuentan como descarga tanto en el dominio de la plataforma como en un dominio de seguimiento verificado (HTTPS).

### Caddy

- **TLS bajo demanda** (`on_demand_tls`): antes de emitir un certificado, Caddy pregunta a `GET /api/tls/allowed?domain=…`, que solo responde 200 para un dominio verificado de un tenant activo. Así nadie puede forzar la emisión de certificados para dominios ajenos apuntando un DNS a la VM.
- **Rutas:** en los dominios propios solo se sirve `/trk/*`, con un cuerpo máximo de 64 KB; el resto redirige con 308 a la plataforma. El centro de preferencias, el inicio de sesión y la API siguen únicamente en el dominio de la plataforma: sin cookies de la app en dominios de terceros y con menos superficie de ataque.
- **Consulta interna:** `/api/tls/*` responde 404 desde fuera, en el dominio de la plataforma.

## Alternativas descartadas

- **CNAME + TXT con token:** la elección del usuario fue solo CNAME, que basta para probar el control del dominio en un único paso.
- **Servir también el centro de preferencias en el dominio propio:** obligaría a abrir páginas, sesión y proxy por host en dominios de terceros.
- **Resolver la URL base consultando la base de datos en cada enlace:** sería una consulta por destinatario y por enlace. La instantánea en memoria tiene un coste despreciable y una latencia de propagación de 1 minuto como máximo.

## Consecuencias

- **Dominio raíz:** no admite CNAME (RFC 1034); hay que usar un subdominio. La interfaz lo indica.
- **Quitar el dominio:** los enlaces de los correos ya enviados con él dejan de funcionar, porque Caddy ya no autoriza su certificado. El diálogo lo advierte.
- **Let's Encrypt (`CADDY_TLS=acme`):** el puerto 80 debe estar abierto para el desafío HTTP-01 de los dominios bajo demanda.
- **En desarrollo** (`APP_URL=http://localhost:3020`) no se puede verificar ningún dominio real. La funcionalidad se prueba con tests unitarios, de integración y E2E, y con el despliegue local con TLS interno.
