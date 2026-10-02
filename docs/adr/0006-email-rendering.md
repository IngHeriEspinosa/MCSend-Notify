# ADR 0006: Compilación de correos con HTML propio, Liquid, juice y sanitize-html

- **Estado:** aceptada (sustituye la parte de React Email del ADR 0002)
- **Fecha:** 2026-10-02
- **Autor:** Ing. Heri Espinosa

## Contexto

Las plantillas de la Fase 2 deben producir correos que se vean bien en Outlook, Gmail y Apple Mail. También deben aceptar variables por destinatario y mostrar la miniatura de los documentos adjuntos. El plan inicial proponía React Email para el layout.

Durante la implementación surgieron tres problemas con React Email:

- Exige `react-dom/server` dentro de `src/infrastructure`, que el proyecto mantiene libre de React para que el worker lo use sin el runtime de Next.js.
- Su render dentro de Server Actions del App Router añade restricciones de empaquetado.
- El layout que se necesita es pequeño: cabecera, bloques, tarjeta de documento y pie.

## Decisión

El compilador es `HtmlEmailCompiler`, en `src/infrastructure/rendering`.

- **Layout propio con tablas** (600 px, preencabezado oculto, media queries para móvil y modo oscuro). Se genera como texto con escape explícito de todo dato variable.
- **Bloques** validados con Zod: titular, texto Markdown, botón a prueba de Outlook, imagen con `alt` obligatorio, dos columnas, separador, espacio y tarjeta de documento con miniatura.
- **Markdown** con markdown-it en modo seguro: sin HTML embebido, y enlaces solo http(s), mailto o variables de sistema.
- **HTML propio**: primero juice aplica los estilos de `<style>` en línea. Después sanitize-html filtra con una lista blanca de etiquetas, atributos, esquemas y propiedades CSS, y rechaza `url()`, `expression()` e `@import`.
- **Variables con LiquidJS** en modo restringido:
  - sin acceso a archivos;
  - solo propiedades propias;
  - sin el filtro `raw`;
  - con límites de tamaño, tiempo y memoria;
  - con escape HTML en el cuerpo.
- **Dos fases**:
  - `prepare` compila una vez y deja las variables pendientes; las etiquetas Liquid se protegen con marcadores mientras pasan por Markdown, el saneador y juice.
  - `personalize` sustituye las variables por destinatario. La Fase 3 lo usará para cada envío.
- **Comprobaciones previas al envío**: dirección postal, documentos no disponibles, variables desconocidas, sintaxis Liquid, tamaño mayor de 102 KB (recorte de Gmail), imágenes sin `alt`, enlaces http, asunto largo, preencabezado y contenido saneado.
- **Pie obligatorio**: siempre se añaden la dirección postal y los enlaces de baja y preferencias.

## Alternativas descartadas

| Opción                        | Motivo                                                                 |
| ----------------------------- | ---------------------------------------------------------------------- |
| React Email                   | Dependencia de React en infraestructura y del runtime de Next.js       |
| MJML                          | Otra sintaxis para los usuarios y un compilador pesado                 |
| Handlebars                    | Permite helpers arbitrarios y su sandbox es más débil que el de Liquid |
| Variables en URL de contactos | Permitiría inyectar `javascript:` o redirecciones abiertas             |

## Consecuencias

- Se evitan dos dependencias (`@react-email/components` y `@react-email/render`) y el worker compila correos sin React.
- La seguridad del contenido se verifica con una batería XSS de 39 vectores (OWASP) y con tests del compilador.
- Para añadir un bloque nuevo hay que tocar el esquema Zod, el renderizador y el editor (`BlockEditor`).
