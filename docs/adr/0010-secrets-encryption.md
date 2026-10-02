# ADR 0010: Cifrado de credenciales de proveedores con AES-256-GCM

- **Estado:** aceptada
- **Fecha:** 2026-10-02
- **Autor:** Ing. Heri Espinosa

## Contexto

Cada tenant guarda en la base de datos las credenciales de sus proveedores de correo: contraseñas SMTP, secretos de cliente de Entra ID, claves de API de Resend, claves de acceso de AWS y secretos de webhook. Una copia de seguridad filtrada o una inyección SQL no deben exponerlas. Una fila copiada a otro tenant o a otro proveedor tampoco debe poder descifrarse.

## Decisión

- **Algoritmo:** AES-256-GCM, con IV aleatorio de 12 bytes y _tag_ de autenticación de 16 bytes (`AesGcmSecretCipher`, puerto `SecretCipher`).
- **Datos asociados (AAD):** `{tenantId}:email_provider:{providerId}`. Si el texto cifrado se mueve a otra fila o a otro tenant, el descifrado falla.
- **Formato:** `{keyId}.{iv}.{tag}.{ciphertext}` en base64url. El identificador de clave permite rotarla.
- **Claves:**
  - `ENCRYPTION_KEYS="k1:base64,k2:base64"`: cada clave tiene 32 bytes;
  - `ENCRYPTION_ACTIVE_KEY_ID` indica la clave con la que se cifra;
  - las claves antiguas siguen sirviendo para descifrar;
  - `pnpm setup` genera la primera con `crypto.randomBytes`.
- **Exposición mínima:**
  - las credenciales se descifran solo en el worker al enviar, o al probar la conexión;
  - el caso de uso nunca devuelve `credentialsEnc` a la interfaz, y los campos secretos del formulario quedan vacíos;
  - al editar, un secreto vacío conserva el valor guardado;
  - los logs redactan `credentials`, `password`, `secret` y `apiKey`.
- **Caché del cliente del proveedor:** el gateway cachea el cliente (por ejemplo, el pool SMTP) por `configVersion`. Al editar el proveedor la versión sube y se crea un cliente nuevo con las credenciales actuales.

## Rotación de claves

1. Añadir la clave nueva a `ENCRYPTION_KEYS` y apuntar `ENCRYPTION_ACTIVE_KEY_ID` a ella.
2. Reiniciar la app y el worker. Las credenciales que se guarden a partir de entonces usan la clave nueva.
3. Volver a guardar los proveedores, o ejecutar el script de rotación cuando exista, para recifrar las filas antiguas.
4. Retirar la clave antigua cuando ninguna fila la use (`AesGcmSecretCipher.needsRotation`).

El script `pnpm secrets:rotate`, que recifra todas las filas de forma automática, queda pendiente para la Fase 5.

## Consecuencias

- Perder `ENCRYPTION_KEYS` obliga a introducir de nuevo las credenciales de todos los proveedores. La clave debe estar en el gestor de secretos de la organización, fuera del servidor.
- Las credenciales no se pueden buscar ni comparar en SQL. No hace falta: siempre se leen por id de proveedor.
