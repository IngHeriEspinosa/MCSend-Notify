# ADR 0003: SeaweedFS como almacenamiento S3 compatible (sustituye a MinIO)

- **Estado:** aceptada
- **Fecha:** 2026-10-02
- **Autor:** Ing. Heri Espinosa

## Contexto

El plan inicial usaba MinIO para documentos, miniaturas e informes. MinIO dejó de publicar imágenes de su edición comunitaria en 2025. A octubre de 2026 no hay ninguna etiqueta disponible en Docker Hub ni en quay.io. El plan ya preveía este riesgo y la posibilidad de sustituirlo, porque la aplicación usa un puerto S3 estándar.

## Opciones evaluadas

| Opción                      | Licencia   | Facilidad de configuración                                                                                | Madurez           |
| --------------------------- | ---------- | --------------------------------------------------------------------------------------------------------- | ----------------- |
| **SeaweedFS** (`weed mini`) | Apache 2.0 | Un contenedor; credenciales por `AWS_ACCESS_KEY_ID` y `AWS_SECRET_ACCESS_KEY`; crea el bucket al arrancar | Alta (desde 2012) |
| Garage                      | AGPL 3.0   | Requiere archivo de configuración y asignar el layout del clúster                                         | Media             |
| RustFS                      | Apache 2.0 | Similar a MinIO                                                                                           | Proyecto joven    |

## Decisión

Se usa **SeaweedFS 4.48** (`chrislusf/seaweedfs:4.48`) en modo `mini`, con la interfaz de administración desactivada. Se verificó lo siguiente:

- rechaza peticiones anónimas con `403 AccessDenied`;
- rechaza claves incorrectas con `InvalidAccessKeyId`;
- acepta peticiones firmadas con las credenciales configuradas.

## Consecuencias

- El código usa el SDK de AWS S3 con `S3_FORCE_PATH_STYLE=true`. Cambiar a AWS S3 o Cloudflare R2 solo requiere variables de entorno.
- Las descargas se sirven a través de la app con enlaces firmados (Fase 2), así que el almacenamiento nunca se expone a Internet.
- Para alta disponibilidad se puede pasar a `weed server` con varios volúmenes o a un S3 gestionado.
