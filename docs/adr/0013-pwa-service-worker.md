# ADR 0013: PWA con Serwist sin datos del tenant en el dispositivo

- **Estado:** aceptada
- **Fecha:** 2026-10-03
- **Autor:** Ing. Heri Espinosa

## Contexto

Las reglas del proyecto piden que toda app web sea una PWA instalable con Serwist. MC Send Notify maneja datos personales de clientes de varios tenants, y suele usarse en equipos compartidos de la oficina. La build usa Turbopack (Next.js 16), y el plan contemplaba `next build --webpack` si Serwist no era compatible.

Opciones evaluadas:

- **`@serwist/next`:** requiere webpack. Obliga a abandonar Turbopack en la build.
- **`@serwist/turbopack`:** depende de `@swc/core`. Añade binarios nativos y un script de instalación más.
- **`serwist` + `@serwist/build`:** el service worker se compila con el esbuild que ya usa el worker, y el manifiesto de precarga se inyecta después de `next build`.

## Decisión

- **Compilación:** `serwist` y `@serwist/build` 9.5.12 (dependencias de desarrollo).
  - [scripts/build-sw.mjs](../../scripts/build-sw.mjs) compila [src/sw/sw.ts](../../src/sw/sw.ts) con esbuild y ejecuta `injectManifest` sobre `.next/static`.
  - El resultado es `public/sw.js`, que no se versiona.
  - La build de Next.js sigue con Turbopack.
- **Precarga:**
  - CSS y fuentes de `/_next/static`;
  - las páginas sin conexión `/es/offline` y `/en/offline`;
  - un icono.
  - La revisión es el `BUILD_ID`: cada despliegue renueva la caché.
- **Estrategias:**
  - `/api/*`, `/trk/*` y navegaciones: **solo red**. Las páginas del tenant, sus datos y las Server Actions nunca se guardan en el dispositivo.
  - Sin conexión se muestra la página offline en el idioma de la URL.
  - JS y CSS con hash: caché primero (30 días, 300 entradas).
  - Logotipos e iconos: caché con revalidación.
- **Registro:**
  - Solo en producción (`ServiceWorkerRegistrar`).
  - `/sw.js` se sirve con `Cache-Control: no-cache` y una CSP propia.
- **Aviso sin conexión:** `OfflineBanner`, con `role="status"`, avisa de que los cambios no se pueden guardar.
- **Manifiesto:** `src/app/manifest.ts`, con iconos de 192 y 512 px (`any` y `maskable`) generados desde el logo.

## Consecuencias

- La app se instala y abre rápido, pero no funciona sin conexión más allá del aviso. Es intencionado: priorizamos la privacidad (orden de prioridades del proyecto: seguridad primero).
- La build tiene un paso más (`node scripts/build-sw.mjs`); el `typecheck` comprueba también `src/sw` con su propio `tsconfig` (lib `WebWorker`).
- La E2E verifica:
  - la instalabilidad con `Page.getInstallabilityErrors` de Chrome;
  - que la caché no contiene rutas `/t/*` ni `/api/*`;
  - la página offline en ES y EN.
