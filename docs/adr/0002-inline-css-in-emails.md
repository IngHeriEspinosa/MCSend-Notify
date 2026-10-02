# ADR 0002: CSS en línea en el HTML de los correos

- **Estado:** aceptada
- **Fecha:** 2026-10-02
- **Autor:** Ing. Heri Espinosa

## Contexto

Las reglas del proyecto prohíben los estilos inline en la UI. Sin embargo, los clientes de correo (Outlook, Gmail, Apple Mail) ignoran o recortan las hojas de estilo y solo respetan de forma fiable el atributo `style`.

## Decisión

- La prohibición de estilos inline aplica a la **UI de la aplicación**, que usa Tailwind, MUI y variables CSS.
- El **HTML de los correos** se genera con estilos en una hoja `<style>` que `juice` aplica en línea; el HTML pegado por el usuario también pasa por `juice`. Los colores salen del branding de cada tenant.

> **Actualización (Fase 2):** el layout se genera sin React Email; ver [ADR 0006](0006-email-rendering.md).

## Consecuencias

- Los correos se ven de forma consistente en los clientes de correo.
- La excepción queda limitada a `src/infrastructure/rendering` (Fase 2) y se revisa en code review.
