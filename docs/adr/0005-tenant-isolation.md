# ADR 0005: Aislamiento multi-tenant en tres capas

- **Estado:** aceptada
- **Fecha:** 2026-10-02
- **Autor:** Ing. Heri Espinosa

## Contexto

Todas las aplicaciones (MCSupport, MCLog...) comparten una base de datos. Una fuga de datos entre tenants, como un IDOR, sería el fallo de seguridad más grave posible en la plataforma.

## Opciones

| Opción                                                        | Ventajas                                         | Inconvenientes                                               |
| ------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| Filtrar `tenantId` a mano en cada consulta                    | Simple                                           | Un olvido basta para filtrar datos                           |
| Row Level Security (RLS) de PostgreSQL                        | Garantía en la base de datos                     | Requiere `SET LOCAL` por transacción y complica el _pooling_ |
| Extensión de Prisma + puertos con contexto + tests de guardia | Garantía automática sin coste de infraestructura | No cubre el SQL en bruto                                     |

## Decisión

Se usa la tercera opción, con tres capas:

1. **Dominio:** cada puerto recibe `TenantContext` y cada caso de uso exige un permiso.
2. **Datos:** `scopeToTenant(prisma, tenantId)`
   - añade `tenantId` a `where` en lecturas, actualizaciones y borrados;
   - lo fija en las creaciones;
   - rechaza mover filas a otro tenant y las escrituras anidadas en relaciones.

   Los clientes extendidos se reutilizan con una caché LRU por tenant.

3. **Guardias:**
   - un test unitario compara `schema.prisma` con la lista de modelos con tenant y sus relaciones;
   - los tests de integración demuestran que no se puede leer, modificar ni relacionar datos de otro tenant, también dentro de transacciones.

El SQL en bruto (compilador de segmentos y upsert por lotes) filtra `tenant_id` de forma explícita y está cubierto por tests de integración. Las referencias del cliente (listas, etiquetas, temas, contactos) se validan contra el tenant antes de usarlas.

## Consecuencias

- Añadir una tabla de negocio exige registrarla en `tenant-models.ts`; si se olvida, los tests fallan.
- RLS queda como defensa adicional opcional para la Fase 5.
