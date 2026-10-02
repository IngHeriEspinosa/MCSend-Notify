# ADR 0007: Procesamiento de documentos y URL públicas firmadas

- **Estado:** aceptada
- **Fecha:** 2026-10-02
- **Autor:** Ing. Heri Espinosa

## Contexto

Los correos deben poder enlazar presentaciones, PDF, documentos de Word, hojas de cálculo, imágenes, HTML y Markdown. Al enviar una presentación debe verse su miniatura. Los clientes de correo cargan las imágenes sin sesión y meses después del envío.

## Decisión

### Flujo de procesamiento

El documento pasa por la cola `document-process` del worker, con tres intentos y backoff exponencial:

1. El route handler valida el tipo real por bytes mágicos con `file-type` y una lista blanca. SVG, ejecutables y comprimidos se rechazan.
2. El original se guarda en `tenants/{tenantId}/documents/{id}/original.{ext}`.
3. Conversión a PDF con Gotenberg 8:
   - LibreOffice para PPTX, PPT, ODP, DOCX, DOC, ODT, XLSX, XLS y ODS;
   - Chromium para HTML, Markdown y texto.
4. poppler (`pdfinfo`, `pdftoppm`, `pdftotext`) obtiene las páginas, la primera página a 1200 px y el texto de las 20 primeras páginas. Se ejecuta con `execFile`, sin shell, en un directorio temporal.
5. sharp genera la miniatura JPEG sin metadatos, con límite de píxeles de entrada.
6. El documento queda en `READY` o, en el último intento, en `FAILED` con un código traducible.

### Seguridad de Gotenberg

Chromium se ejecuta sin JavaScript y con una lista de URL permitidas que solo incluye `file:///tmp/`. Un HTML subido no puede hacer peticiones a la red interna (SSRF) ni ejecutar código.

### URL públicas

Las rutas `/trk/i/{token}` (imagen) y `/trk/d/{token}` (descarga) usan un token `base64url(JSON) + "." + HMAC-SHA256` truncado a 16 bytes:

- El HMAC lleva un prefijo de dominio y se compara en tiempo constante.
- El token identifica el tenant y el recurso; no caduca, para que los correos antiguos sigan funcionando.
- El recurso deja de servirse si se elimina.

### Archivos para la interfaz

Se sirven por `/api/t/{slug}/documents/{id}/file` con sesión. Todas las respuestas de archivo llevan:

- `X-Content-Type-Options: nosniff`;
- `Content-Security-Policy: default-src 'none'; sandbox`;
- descarga como adjunto del original.

## Alternativas descartadas

| Opción                               | Motivo                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------- |
| pdf.js con canvas para rasterizar    | Peor fidelidad tipográfica y más memoria                                  |
| URL prefirmadas de S3                | Caducan (máx. 7 días) y exponen el almacenamiento                         |
| Adjuntar siempre el archivo          | Mensajes pesados, peor entregabilidad y sin control de descargas          |
| Miniatura con texto incrustado (PNG) | El texto en imagen no es accesible; los datos van en la tarjeta como HTML |

## Consecuencias

- El worker necesita poppler. Viene incluido en la imagen Docker. En Windows hay que ejecutar el worker en Docker o indicar `POPPLER_BIN_DIR`.
- La Fase 3 reutilizará `/trk/d` para registrar descargas y el firmante HMAC para el resto del tracking.
- Si se borra un documento, sus enlaces dejan de funcionar también en los correos ya enviados. La interfaz avisa al eliminarlo.
