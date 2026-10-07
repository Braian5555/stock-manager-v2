# Stock Manager

Aplicación de **inventario, stock, conteos, proveedores, pedidos y movimientos**. PWA instalable, mobile-first, funciona **sin conexión** y guarda los datos en el dispositivo. Genérica y configurable para cualquier tipo de negocio. Incluye una capa de integraciones preparada para **Maxirest** (ver [docs/maxirest.md](docs/maxirest.md) para el estado real).

**Producción:** https://braian5555.github.io/stock-manager/

---

## Funcionalidades

| Módulo | Qué hace |
|---|---|
| Inicio | Tarjetas (productos, stock total, stock bajo, sin stock, pedidos pendientes, proveedores), alertas 🟢🟡🟠🔴, últimos movimientos. |
| Stock | Tarjetas con estado, búsqueda, filtros (familia, proveedor, ubicación, estado), orden (nombre, cantidad, familia, ubicación), registrar movimientos con *Deshacer*. |
| Conteo | Conteo pensado para celular (`[-] [ n ] [+]`), por ubicación y/o familia, resumen de diferencias (aumentos, disminuciones, sin cambios) y aplicación con confirmación. |
| Pedidos | Borrador → pendiente → enviado → recibido / cancelado. Crear, editar, duplicar, eliminar, copiar texto, **recibir** (suma stock con unidad de compra y registra movimiento). **Pedido sugerido** agrupado por proveedor (hasta el máximo o hasta el mínimo). |
| Productos | Alta/edición/duplicado/eliminación (con deshacer), SKU, familia, unidad de stock y de compra con equivalencia (1 caja = 12 u), ubicación, proveedor principal y alternativos, mín/máx, activo. |
| Proveedores, Familias, Unidades, Ubicaciones | ABM genérico; eliminar deja los productos sin ese dato (no los borra) y se puede deshacer. |
| Movimientos | Historial: fecha, hora, producto, anterior, nuevo, diferencia, tipo, motivo, origen. Revertir con ajuste inverso. |
| Conciliación | Stock Manager vs. Maxirest con filtros y ajustes confirmados. |
| Exportar y backup | PDF, DOCX, XLSX, JSON (todo o por sección). Backup completo y restauración validada. Importación de productos desde XLSX/CSV. |
| Integraciones | Maxirest: asistente de 7 pasos, mock, Excel Bridge, gateway, vínculos, cola de sincronización. |
| Configuración | Nombre, subtítulo, logo (predeterminado/emoji/imagen), colores, tema claro/oscuro/automático, nombre/orden/visibilidad del menú, umbral crítico, modo de pedido sugerido. |

Búsqueda global con `Ctrl/⌘ + K` (productos, códigos, proveedores, familias, ubicaciones, unidades).

---

## Arquitectura

React 19 + TypeScript + Vite · Dexie (IndexedDB) · React Router (HashRouter) · vite-plugin-pwa (Workbox) · lucide-react. Exportadores (ExcelJS, jsPDF, docx) se cargan **bajo demanda**.

```
src/
  models/          Tipos de dominio (Product, StockMovement, Order, InventoryCount, Integration, SyncJob, ExternalReference…)
  database/        Esquema Dexie versionado (v1, v2) y migraciones
  services/        Lógica de negocio: stock (movimientos idempotentes), productos, pedidos, conteos, backup, búsqueda, configuración, datos base
  integrations/
    core/          Integration Layer: contrato de adaptadores, sync engine + cola, vínculos, conciliación, errores
    mock/          MockMaxirestAdapter (demostración)
    maxirest/      MaxirestGatewayAdapter, Excel Bridge, estado oficial documentado
    integrationService.ts, registry.ts
  exports/         Datasets + escritores PDF/DOCX/XLSX/JSON
  importers/       Lectura XLSX/CSV, importación de productos
  pwa/             Aviso de actualización del SW, iconos dinámicos
  store/           Contextos: configuración/tema, notificaciones/confirmaciones/deshacer
  hooks/           Consultas reactivas (useLiveQuery), online/offline, sync automática
  layouts/         Sidebar (desktop) + barra inferior (móvil)
  components/      UI reutilizable (Modal accesible, Field, Stepper, formularios, paneles de integración)
  pages/           Pantallas
  styles/          CSS con tokens (claro/oscuro)
  utils/           ids (UUID), formato, color/contraste
server/gateway-reference/   Backend de integración neutral de plataforma (referencia)
tests/unit/                 Vitest + fake-indexeddb
tests/e2e/                  Playwright contra el build de producción (móvil y desktop)
scripts/                    verify-build, test-sw-update, generate-icons
```

Principios: la UI nunca toca IndexedDB directamente para escribir; todo cambio de stock pasa por `applyMovement()` (transaccional e **idempotente** por `idempotencyKey` con índice único). Todas las entidades tienen `id` (UUID), `createdAt`, `updatedAt`.

Preparado para el futuro (no implementado): usuarios/roles, backend y sync cloud, múltiples sucursales/negocios (`Business` ya existe), código de barras/QR, reportes avanzados, otras integraciones (nuevo adaptador en `src/integrations/`).

---

## Instalación y desarrollo

Requisitos: Node 20+ (probado con 22).

```bash
npm install
npm run dev          # http://localhost:5173/stock-manager/  (sin service worker en desarrollo)
```

| Script | Descripción |
|---|---|
| `npm run build` | `tsc` + build de producción + **verificación del build** (`scripts/verify-build.mjs`) |
| `npm run preview` | Sirve `dist/` en http://localhost:4173/stock-manager/ |
| `npm run lint` | ESLint (incluye regla que prohíbe `innerHTML`) |
| `npm test` | Tests unitarios (Vitest) |
| `npm run test:e2e` | Tests E2E (Playwright, móvil + desktop, contra el build) |
| `npm run test:sw` | Prueba de actualización del service worker (deploy A → B) |
| `npm run icons` | Regenera los PNG de la PWA desde `public/favicon.svg` |

### Variables de entorno

Ver [.env.example](.env.example). Todo lo que empieza con `VITE_` es **público** (queda en el bundle): nunca poner secretos.

| Variable | Default | Uso |
|---|---|---|
| `VITE_BASE_PATH` | `/stock-manager/` | Base de publicación. `/` para dominio propio. |
| `VITE_DEFAULT_GATEWAY_URL` | vacío | URL pública del gateway de integración (opcional). |

---

## Deploy en GitHub Pages

1. En el repositorio: **Settings → Pages → Source: GitHub Actions**.
2. Hacer push a `main`. El workflow `.github/workflows/deploy.yml` corre lint, tests unitarios, build verificado, E2E y la prueba de actualización del SW, y publica `dist/`.
3. Abrir https://braian5555.github.io/stock-manager/

> **Importante:** la versión anterior publicaba la rama directamente (un `index.html` suelto). Con este proyecto Pages **debe** publicar desde GitHub Actions; si se publica la rama `main` “tal cual”, el navegador recibiría `/src/main.tsx` sin compilar.

### Por qué ya no puede aparecer código en pantalla

El problema anterior: un `<script>` escrito dentro de un template string en un script inline cerraba la etiqueta antes de tiempo y el resto del JavaScript se mostraba como texto. Ahora:

- El HTML no tiene scripts inline (y la CSP los bloquea): sólo un `<script type="module" src=…>` generado por Vite.
- Exportaciones PDF/Word se generan como archivos (jsPDF/docx), sin `document.write` ni HTML concatenado.
- `scripts/verify-build.mjs` falla el build si: hay texto visible en `<body>`, scripts inline, etiquetas `<script>` desbalanceadas, referencias a `.tsx`, rutas fuera de `/stock-manager/` o archivos inexistentes, manifest/SW mal configurados.
- El E2E verifica en el navegador que el texto visible no contenga código.

## PWA y service worker

- `manifest.webmanifest` con `start_url` y `scope` = `/stock-manager/`, iconos 192/512/maskable y `apple-touch-icon`.
- Workbox `generateSW`: precache **versionado por hash**, `cleanupOutdatedCaches`, fallback de navegación sólo a `index.html` dentro del scope (nunca para archivos).
- Actualización controlada (`registerType: 'prompt'`): la versión nueva se descarga, aparece *“Hay una nueva versión disponible — Actualizar”* y sólo entonces se activa y recarga. Se busca actualización al abrir y cada hora. Probado en `npm run test:sw`.
- Sin service worker en `npm run dev`.
- Instalación: Android/Chrome/Edge (menú → Instalar app), iPhone (Safari → Compartir → Agregar a inicio), escritorio (icono de instalar en la barra de direcciones).
- HashRouter: las rutas son `/stock-manager/#/stock`, así GitHub Pages nunca devuelve 404 al recargar.

## Almacenamiento, backup y restauración

- IndexedDB (`stock-manager`) vía Dexie, esquema versionado: **v1** núcleo, **v2** integraciones + unidad de compra/proveedores alternativos (migración que completa campos sin perder datos). Nuevas versiones: agregar `this.version(n).stores(...).upgrade(...)` en `src/database/db.ts`, nunca editar una versión publicada.
- Se pide almacenamiento persistente (`navigator.storage.persist()`); el estado se ve en Configuración.
- **Exportar backup**: JSON completo con relaciones e IDs externos, **sin** secretos (se eliminan recursivamente campos como `password`, `token`, `apiKey`…).
- **Restaurar backup**: valida formato, versión y registros; muestra advertencia *“Esta acción reemplazará los datos actuales.”*; restaura en una transacción y permite **Deshacer**.

## Maxirest

Ver [docs/maxirest.md](docs/maxirest.md). En resumen: **no existe una API pública documentada**. Funciona hoy el **Excel Bridge** (manual); el **mock** simula todo el flujo; el adaptador real vía **gateway** está preparado y responde `NOT_SUPPORTED` hasta que Maxirest habilite un acceso oficial.

## Pruebas

- **Unitarias (27)**: estados de stock, movimientos idempotentes, deshacer, pedidos (recepción, parcial, factor de compra, no duplicar), pedido sugerido (2/10/30 → 28), conteos, backup (validación, secretos), migración v1→v2, mock, cola, conciliación, Excel Bridge, adaptador gateway y contrato con el gateway de referencia.
- **E2E (Playwright, móvil Pixel 7 + desktop 1366px)**: abrir sin código visible ni errores de consola, crear producto/proveedor y relacionarlos, cambiar stock y deshacer, conteo con diferencias, pedido y recepción, persistencia (pestaña y **cierre completo del navegador**), backup/restauración, exportación XLSX/PDF/DOCX (archivos válidos), PWA (manifest, SW controlando) y **uso offline**, alertas y pedido sugerido, navegación móvil/desktop sin scroll horizontal, personalización, búsqueda global, flujo Maxirest simulado completo (asistente, conciliación, ajuste confirmado, error comprensible, cola y reintento, desconexión segura) y Excel Bridge con archivo real.
- **Actualización del SW**: deploy A → B en la misma URL.
