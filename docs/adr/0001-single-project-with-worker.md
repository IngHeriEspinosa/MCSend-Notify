# ADR 0001: Proyecto único de Next.js con worker en `src/worker`

- **Estado:** aceptada
- **Fecha:** 2026-10-02
- **Autor:** Ing. Heri Espinosa

## Contexto

La plataforma necesita una app web (Next.js) y un proceso de larga duración para las colas: envíos masivos, conversión de documentos y automatizaciones. Ambos comparten dominio, persistencia y adaptadores.

## Decisión

Un **único proyecto** con el worker en `src/worker/`:

- **Desarrollo:** se ejecuta con `tsx watch`.
- **Producción:** se empaqueta con esbuild en `dist/worker/index.mjs`. El código propio se incluye en el bundle y las dependencias quedan externas.
- **Imagen:** un Dockerfile multi-target (`app`, `worker` y `migrate`).
- **Límites entre capas:** los hace cumplir ESLint con `no-restricted-imports`.

## Consecuencias

- Hay un solo cliente Prisma, un solo lockfile y una sola CI.
- `src/core` e `src/infrastructure` no pueden depender de Next.js ni de React, porque el worker también los importa.
- Se migrará a un monorepo (pnpm workspaces) solo si aparece un SDK público, un segundo frontend o un equipo separado.
