# ADR 0011: Integración de IA con el SDK oficial de Claude, guardrails y presupuesto

- **Estado:** aceptada
- **Fecha:** 2026-10-03
- **Autor:** Ing. Heri Espinosa

## Contexto

La plataforma usa IA para redactar campañas a partir de fuentes (texto, páginas web, feeds RSS, documentos y el buzón de novedades), proponer asuntos, traducir, ajustar el tono, crear segmentos en lenguaje natural y resumir resultados. Cada tenant puede usar la IA de la plataforma (Claude con la clave de Multicómputos) o su propia clave de Anthropic, OpenAI o un servidor compatible con OpenAI (Ollama, vLLM).

El plan proponía Vercel AI SDK. Claude Opus 5.5, el modelo por defecto, tiene particularidades que una capa genérica no garantizaba:

- el razonamiento siempre está activo y se regula solo con `output_config.effort`;
- `temperature` y `tool_choice` forzado devuelven error;
- el motivo de parada `refusal` debe comprobarse antes de leer el contenido.

## Decisión

### Adaptadores detrás de un puerto

El dominio define el puerto `LanguageModel.generateObject(request)`: instrucciones del sistema, petición, esquema Zod y límites. Hay dos adaptadores:

- **`AnthropicLanguageModel`** usa el SDK oficial `@anthropic-ai/sdk`:
  - salida estructurada nativa (`output_config.format` con el JSON Schema del esquema Zod) y validación de nuevo con Zod al recibirla;
  - `effort` solo en los modelos que lo admiten; no se envía `thinking`, `temperature` ni `tool_choice`;
  - instrucciones del sistema con `cache_control` (caché de prompts por tenant);
  - `refusal`, `max_tokens` y errores HTTP tipados se traducen a códigos de dominio y conservan el uso consumido.
- **`OpenAiCompatibleLanguageModel`** usa `fetch` contra `/chat/completions`, sin SDK:
  - `response_format: json_schema` estricto;
  - la URL la configura el tenant, así que va por `safeFetch` (sin IP privadas salvo en desarrollo y sin reenviar la clave a otro origen en redirecciones).

La decisión la tomó el usuario: SDK oficial para Claude más `fetch` para el resto. Supone una dependencia nueva en lugar de las cuatro del plan.

### Guardrails

1. **Fuentes como datos.** Las fuentes van en etiquetas `<source>` y el prompt del sistema prohíbe seguir instrucciones que contengan. Una fuente no puede «cerrar» su etiqueta.
2. **Lista blanca de enlaces.** Ningún enlace llega al correo si no es citable. Son citables:
   - las URL que escribe el editor;
   - la propia página y sus enlaces reales (`href`), no las URL que aparecen en su texto;
   - los enlaces de los elementos RSS;
   - las URL de las novedades publicadas por la aplicación;
   - las variables de baja y preferencias.

   Se eliminan enlaces Markdown, imágenes (posibles píxeles de seguimiento ajenos), referencias, enlaces automáticos y URL sueltas. La detección usa el mismo `linkify` que el renderizado del correo, así que lo que se filtra es exactamente lo que se convertiría en enlace.

3. **Traducción y tono por unidades de texto.** La IA recibe solo textos con un id y nunca ve URL, documentos ni estructura. Cada texto devuelto se valida: longitud, mismas variables Liquid y ningún enlace nuevo. Si no pasa, se conserva el original.
4. **La IA nunca envía.** El editor revisa el borrador, y las automatizaciones exigen aprobación humana por defecto. La página de aprobación muestra los enlaces eliminados como indicio de inyección.

### Coste y abuso

- Cada llamada registra tokens, coste (micro-USD con la tarifa del modelo o la configurada para modelos sin tarifa conocida), latencia y resultado en `ai_usage`, también si falla.
- **Presupuesto mensual por tenant** (mes natural UTC), calculado con la suma de `ai_usage`. Con la IA de la plataforma nunca supera `PLATFORM_AI_MONTHLY_BUDGET_USD`.
- Límite de 30 peticiones por hora y usuario en las acciones de asistencia.

### Fuentes externas

`HttpSourceFetcher` descarga páginas y feeds con `safeFetch`:

- solo hosts públicos y puertos 80/443, con el DNS fijado para la conexión (sin _DNS rebinding_);
- metadatos de nube bloqueados siempre;
- 2 MB y 10 s como máximo, y tipos de contenido limitados.

El XML se rechaza si declara DOCTYPE o entidades (XXE).

## Consecuencias

- Añadir otro proveedor solo requiere un adaptador nuevo del puerto.
- La caché de prompts solo ahorra cuando el prefijo supera el mínimo del modelo. Las instrucciones actuales son cortas, así que el ahorro real es pequeño hasta que se añadan guías de marca largas.
- El presupuesto se comprueba antes de cada llamada y el coste se conoce después. Una llamada puede superar ligeramente el límite; la siguiente ya se rechaza.
- El smoke test contra la API real de Anthropic queda pendiente de una clave (`PLATFORM_AI_ANTHROPIC_API_KEY`).
