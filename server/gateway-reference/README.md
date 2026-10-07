# Integration Gateway (referencia)

Backend mínimo y **neutral de plataforma** entre la PWA y Maxirest.

```
PWA (GitHub Pages)  →  Gateway (este código)  →  Maxirest (cuando habilite acceso oficial)
```

- Hoy responde `health`, declara todas las operaciones como `pending_enablement` y devuelve **501** en el resto. No inventa ninguna llamada a Maxirest.
- Las credenciales que Maxirest pudiera entregar se guardan como **secretos de la plataforma** (`wrangler secret put`, variables de entorno de Vercel/Render/Railway). Nunca en el frontend, en GitHub ni en backups.
- `GATEWAY_ALLOWED_ORIGIN`: origen(es) permitidos para CORS, por defecto `https://braian5555.github.io`.

## Despliegue

| Plataforma | Cómo |
|---|---|
| Cloudflare Workers | `main = "handler.mjs"` en `wrangler.toml`; `npx wrangler deploy` |
| Vercel | `api/[...path].mjs` con `export default (req) => handle(req, process.env)` (runtime Edge) |
| Render / Railway / servidor propio | Node 18+: `http.createServer` + `Request` → `handle()` (o Hono/Express adaptando) |

La autenticación entre la PWA y el gateway (si hiciera falta) debe ser por sesión con cookie `HttpOnly; Secure; SameSite=None` o un proxy de identidad (p. ej. Cloudflare Access): la PWA llama con `credentials: 'include'` y nunca maneja tokens.
