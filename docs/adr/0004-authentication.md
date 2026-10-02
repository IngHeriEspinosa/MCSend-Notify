# ADR 0004: Autenticación con Auth.js v5 (credenciales y Microsoft Entra ID)

- **Estado:** aceptada
- **Fecha:** 2026-10-02
- **Autor:** Ing. Heri Espinosa

## Contexto

El equipo de Multicómputos usa Microsoft 365, pero también hay que dar acceso a personas sin cuenta corporativa, como colaboradores de cada producto. Se decidió con el usuario usar Auth.js con Entra ID y credenciales de respaldo.

## Decisión

- **Auth.js 5.0.0-beta.32** (versión exacta) con sesión **JWT** de 8 horas. El proveedor de credenciales exige JWT.
- **Credenciales:**
  - contraseñas con argon2id (19 MiB, 2 iteraciones);
  - bloqueo de 15 minutos tras 5 intentos fallidos;
  - límite de 10 intentos cada 15 minutos por IP y email, en Redis;
  - mismo mensaje para usuario inexistente y contraseña incorrecta, con verificación ficticia para igualar los tiempos.
- **Entra ID (opcional):** se activa si están las tres variables `AUTH_MICROSOFT_ENTRA_ID_*`. Solo entran los dominios de `AUTH_ALLOWED_EMAIL_DOMAINS`, que también limitan la vinculación por email con una cuenta existente.
- **Revocación:** el JWT lleva `sessionVersion`. Cada 60 s se comprueba contra la base de datos que el usuario siga activo y que la versión coincida. Cambiar la contraseña incrementa la versión.
- **Ubicación:** la integración con Auth.js vive en `src/app/_server/auth.ts`, porque es un mecanismo de entrega. El dominio solo conoce `AuthenticateWithCredentialsUseCase` y sus puertos.
- **El proxy** solo redirige al login si no hay cookie de sesión. La autorización real se verifica en cada página, Server Action y route handler.

## Consecuencias

- Las sesiones no se pueden revocar de forma instantánea: tardan como mucho 60 s (caché por proceso).
- Auth.js v5 sigue en _beta_ y está en mantenimiento. Al estar aislado en `src/app/_server`, migrar a otra librería afecta solo a esa carpeta y a la página de login.
- Las invitaciones se comparten como enlace de un solo uso (7 días). El envío por correo llegará con el correo del sistema (Fase 3).
