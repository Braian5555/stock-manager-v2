# Lector de facturas con IA (Cloudflare Worker)

Servidor mínimo y gratuito entre la app y la IA. Guarda la clave como secreto, verifica la sesión
de Firebase de quien llama (firma de Google) y que sea miembro del espacio de trabajo (leyendo el
espacio en Firestore con la sesión del propio usuario), y reenvía el pedido sin interpretarlo.

- **Gemini (Google, plan gratis)**: secreto `GEMINI_API_KEY` (aistudio.google.com → Get API key).
  La app manda a `POST /gemini`. Prueba los modelos de `GEMINI_MODELS` en orden (si uno no existe o
  no está en el plan gratis, sigue con el próximo); `GEMINI_MODEL` fija uno.
- **Claude (Anthropic, pago)**: secreto `ANTHROPIC_API_KEY`. La app manda a `POST /`.
- `GET /` informa qué IA tiene clave cargada (la app lo usa para armar el pedido correcto).

Instalar: Cloudflare → Workers & Pages → Create → Worker → *Edit code* → pegar `worker.js` → Deploy.
En la app: Configuración → Lectura con IA → pegar la dirección `https://….workers.dev`.

Pruebas: `tests/unit/invoice-worker.test.ts`. Si cambia la dirección de la app, agregarla en
`ALLOWED_ORIGINS`.
