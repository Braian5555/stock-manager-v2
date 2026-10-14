# Lector de facturas con IA (Cloudflare Worker)

Servidor mínimo y gratuito entre la app y la API de Claude. Guarda la clave de Anthropic como
secreto, verifica la sesión de Firebase de quien llama (firma de Google) y que sea miembro del
espacio de trabajo (leyendo el espacio en Firestore con la sesión del propio usuario), y reenvía
el pedido sólo si es para el modelo permitido.

Instalar: Cloudflare → Workers & Pages → Create → Worker → *Edit code* → pegar `worker.js` → Deploy.
Secreto: Settings → Variables and Secrets → Add → Secret `ANTHROPIC_API_KEY`.
En la app: Configuración → Lectura con IA → pegar la dirección `https://….workers.dev`.

Pruebas: `tests/unit/invoice-worker.test.ts`. Si cambia la dirección de la app, agregarla en
`ALLOWED_ORIGINS`.
