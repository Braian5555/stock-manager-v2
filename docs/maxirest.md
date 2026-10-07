# Integración con Maxirest

> **Resumen del estado real (revisión del 06/10/2026)**
>
> | Categoría | Qué hay |
> |---|---|
> | **Funcionando** | Excel Bridge (manual): importar el inventario exportado de Maxirest y exportar un Excel para cargar el conteo en Maxirest. |
> | **Simulado** | `MockMaxirestAdapter`: todo el flujo (asistente, sincronización, vínculos, conciliación, ajustes, cola, errores) contra datos inventados. Siempre marcado como *“Modo demostración — Maxirest simulado”*. |
> | **Preparado** | Integration Layer, `MaxirestGatewayAdapter`, contrato del gateway, gateway de referencia, cola idempotente, conciliación, mapeos. |
> | **Real (API)** | **No existe.** No se conectó contra ninguna instancia real de Maxirest. No hay API pública documentada que permita hacerlo. |
>
> Stock Manager **no dice estar “integrado con Maxirest”**. Dice exactamente lo de arriba.

---

## 1. Investigación de la documentación oficial

Fuentes revisadas (todas oficiales):

- [¿Qué es una integración? — Ayuda Maxirest](https://ayuda.maxirest.com/integraciones/%C2%BFque-es-una-integracion-)
- [Integraciones con nuestros partners — Ayuda Maxirest](https://ayuda.maxirest.com/partners)
- [Partners — maxirest.com/integraciones](https://maxirest.com/integraciones)
- [Inventarios — Ayuda Maxirest](https://ayuda.maxirest.com/es_ES/carga-y-control-de-stock-c-/inventarios)
- [4. Inventario (Costos) — Ayuda Maxirest](https://ayuda.maxirest.com/costos/4-inventario)
- [Insumos — Ayuda Maxirest](https://ayuda.maxirest.com/carga-de-insumos/insumos-stock)
- [Creación de insumos — Ayuda Maxirest](https://ayuda.maxirest.com/configuraciones-para-ingresar-mercaderia/creacion-de-insumos)
- [Conceptos de movimientos de stock — Ayuda Maxirest](https://ayuda.maxirest.com/es_ES/informes-y-configuraciones-varias/conceptos-de-movimientos-de-stock)
- [Informe movimientos de stock — Ayuda Maxirest](https://ayuda.maxirest.com/informes-y-configuraciones-varias/informe-movimientos-de-stock)
- [Informe stock actual / a reponer — Ayuda Maxirest](https://ayuda.maxirest.com/acciones/informe-stock-actual-a-reponer)
- Depósitos, integraciones de delivery, salón y cobros (páginas enlazadas desde las anteriores).

`https://maxirest.com.ar/stock/` devolvió 404 al momento de la revisión.

### Respuestas a la investigación obligatoria

| # | Pregunta | Respuesta según la documentación oficial |
|---|---|---|
| 1 | Documentación oficial actual | Centro de ayuda `ayuda.maxirest.com` y página de partners. |
| 2 | Mecanismos reales de integración | “Integraciones” = configuraciones para vincular el sistema con **partners**: delivery (PedidosYa, Rappi, MásDelivery, Tucán, Mercado Pago Delivery), salón (Waitry, Orderfast), cobros/promociones (Mercado Pago, Payway, Alax), Clover. **Ninguna cubre stock, insumos ni inventarios.** |
| 3 | ¿API pública, privada o interfaz habilitada? | **No se encontró API pública** ni portal de desarrolladores. La única puerta posible es el botón “Quiero ser partner” → `partners.maxisistemas.com.ar` (no documentado). |
| 4 | Autenticación | **No documentada.** |
| 5 | Endpoints reales | **No documentados.** |
| 6 | Operaciones disponibles | Dentro de Maxirest (manual): inventarios por depósito/turno, filtro por rubro, columna “conteo”, ajuste automático de stock con concepto, **exportar inventario a Excel** e **“importar inventarios hechos con anterioridad”**. |
| 7 | Limitaciones | No hay plantilla ni nombres de columnas documentados para el Excel. No hay exportación documentada del listado de insumos. No se documenta si “importar” lee un Excel externo o sólo inventarios previos de Maxirest. |
| 8 | Requisitos | Usuario con acceso al módulo Stock → Inventarios. |
| 9 | ¿Hace falta contactar a Maxirest? | **Sí**, para cualquier integración automática. Contactos publicados: WhatsApp/usuarios (11) 5352-8300, comercial +54 11 5352-0303, formulario web. |
| 10 | Documentar | Este archivo + `src/integrations/maxirest/officialStatus.ts` (la UI muestra esta tabla en *Integraciones → Qué está disponible*). |

### Conceptos de Maxirest y su equivalente

| Maxirest | Stock Manager | Notas |
|---|---|---|
| Insumo (código, descripción, rubro, unidad de medida, depósito, envases, contenido neto) | `Product` | Vínculo en `product.externalSystems.maxirest = { id, code, lastSyncedAt }`. |
| Rubro | `Category` | Nunca se crean rubros en Maxirest. |
| Unidad de medida | `Unit` | Equivalencias de compra/stock en cada producto (`purchaseUnitId` + `purchaseFactor`). |
| Depósito | `Location` | Sin depósitos hardcodeados. Maxirest pide un inventario por depósito. |
| Inventario (fecha, turno, depósito, conteo) | `InventoryCount` / `InventoryCountItem` | Un conteo puede compararse contra el stock de Maxirest (`baseline: 'maxirest'`). |
| Concepto de movimiento / remito | `StockMovement.type` + `reason` | |
| Stock mínimo / tope de reposición | `minStock` / `maxStock` | |

---

## 2. Qué soporta cada operación

| Operación (`IntegrationAdapter`) | Maxirest oficial | Mock | Gateway (hoy) |
|---|---|---|---|
| `getProducts` (insumos) | Pendiente de habilitación | Simulado | `NOT_SUPPORTED` |
| `getCategories` (rubros) | Pendiente de habilitación | Simulado | `NOT_SUPPORTED` |
| `getUnits` | Pendiente de habilitación | Simulado | `NOT_SUPPORTED` |
| `getLocations` (depósitos) | Pendiente de habilitación | Simulado | `NOT_SUPPORTED` |
| `getStock` | **Manual (Excel)** | Simulado | `NOT_SUPPORTED` |
| `getMovements` | Pendiente de habilitación (sólo informe en pantalla) | Simulado | `NOT_SUPPORTED` |
| `getInventory` | **Manual (Excel)** | Simulado | `NOT_SUPPORTED` |
| `createStockAdjustment` | Pendiente de habilitación (se hace dentro de Maxirest) | Simulado | `NOT_SUPPORTED` |
| `updateInventory` | **Manual** (cargar “conteo” en Maxirest) | Simulado | `NOT_SUPPORTED` |
| `createOrder` | No documentado | `NOT_SUPPORTED` (a propósito) | `NOT_SUPPORTED` |

Lectura de stock: **manual vía Excel**. Ajuste de stock automático: **pendiente de habilitación**. Pedido automático: **no confirmado**.

---

## 3. Arquitectura

```
Stock Manager (UI)
      ↓
integrationService.ts          ← casos de uso: configurar, probar, sincronizar, ajustes, cola
      ↓
Integration Layer (src/integrations/core)
  ├─ types.ts          IntegrationAdapter, capacidades, IntegrationError(NOT_SUPPORTED…)
  ├─ syncEngine.ts     sincronización por pasos + Sync Queue idempotente
  ├─ linking.ts        vínculos sin duplicados, sugerencias por código/nombre
  ├─ reconciliation.ts conciliación
  └─ errors.ts         mensajes comprensibles (detalle técnico aparte)
      ↓
Adapters
  ├─ mock/MockMaxirestAdapter.ts          demostración
  ├─ maxirest/MaxirestGatewayAdapter.ts   real, vía gateway propio
  └─ maxirest/excelBridge.ts              puente manual por Excel
```

`BaseAdapter` hace que **toda** operación lance `NOT_SUPPORTED` salvo que el adaptador la implemente. El adaptador real además consulta `GET /capabilities` del gateway y sólo ejecuta lo declarado como `supported`.

### Credenciales

- La PWA **nunca** guarda API keys, passwords, tokens ni client secrets (ni en IndexedDB, ni en `localStorage`, ni en backups, ni en logs). Lo único que se guarda es la **URL pública** del gateway.
- La URL se valida: HTTPS obligatorio y sin usuario/contraseña/parámetros.
- El backup elimina recursivamente cualquier campo con nombre de secreto (`stripSecrets`), y al restaurar las integraciones quedan *desconectadas*.
- Si Maxirest entrega credenciales, viven **sólo** en el gateway como secretos de la plataforma.

```
PWA  →  Backend / API Gateway (Vercel · Cloudflare Workers · Render · Railway · servidor propio)  →  Maxirest
```

Ver `server/gateway-reference/` (handler estándar `Request → Response`, sin dependencia de plataforma).

### Contrato del gateway (propio de Stock Manager, **no** es la API de Maxirest)

| Método | Ruta | Respuesta |
|---|---|---|
| GET | `/v1/maxirest/health` | `{ ok, maxirest }` |
| GET | `/v1/maxirest/capabilities` | `{ capabilities: { getStock: 'supported' \| 'not_supported' \| 'pending_enablement', … } }` |
| GET | `/v1/maxirest/products` · `categories` · `units` · `locations` | `ExternalProduct[]` / `ExternalNamed[]` |
| GET | `/v1/maxirest/stock` | `ExternalStock[]` |
| GET | `/v1/maxirest/movements?since=ISO` | `ExternalMovement[]` |
| GET | `/v1/maxirest/inventory?location=ID` | `ExternalInventoryLine[]` |
| POST | `/v1/maxirest/stock-adjustments` · `inventory` · `orders` | `{ externalId? }` — header `Idempotency-Key` obligatorio |

Códigos: `501` = operación no habilitada (→ `NOT_SUPPORTED`), `401/403` = acceso rechazado, `400/422` = datos inválidos, `5xx` = error del sistema externo (→ queda pendiente para reintentar).

---

## 4. Configuración (Integraciones → Maxirest → Configurar)

Asistente de 7 pasos: **Configurar → Probar → Importar → Resumen (insumos, rubros, depósitos, unidades) → Mapear → Confirmar → Sincronizar**.

Modos:

| Modo | Uso |
|---|---|
| Modo independiente | Por defecto. La app funciona completa sin Maxirest. |
| Demostración (Maxirest simulado) | Probar el flujo. Nada sale del dispositivo. |
| Excel Bridge | El camino disponible hoy. |
| Maxirest vía gateway | Cuando exista un acceso oficial y un gateway desplegado. |

Estados: `No configurado` · `Configurado` · `Conectado` · `Error` · `Desconectado`.

**Sistema principal de stock** (configurable):

| Opción | Efecto al sincronizar |
|---|---|
| Maxirest (recomendado) | El stock local de productos vinculados se alinea al de Maxirest (queda como movimiento `ajuste`, origen `sincronizacion`). Stock Manager funciona como herramienta de control/conteo. |
| Stock Manager | Los movimientos de Maxirest se aplican localmente, idempotentes por `externalMovementId`. |
| Manual | No se toca ningún stock: sólo se guardan los datos para *Conciliación*. |

**Desconectar** detiene la sincronización. No borra productos, proveedores, movimientos, pedidos ni vínculos.

---

## 5. Mapeo

- Producto ↔ Insumo, Familia ↔ Rubro, Unidad ↔ Unidad, Ubicación ↔ Depósito.
- Se guarda el **ID** y el **código** externos (no se depende del nombre).
- Las coincidencias por código (= SKU) o por nombre se **sugieren** pero se aplican sólo al tocar *Guardar vínculos*.
- Un registro externo sólo puede vincularse a **una** entidad local; `createProductFromExternal` rechaza crear un duplicado.
- Insumos no vinculados: *“N insumos de Maxirest no están vinculados”* → *Vincular*.

## 6. Sincronización, idempotencia y cola

- *Sincronizar ahora* ejecuta pasos independientes y muestra `Productos ✓ · Categorías ✓ · Unidades ✓ · Depósitos ✓ · Stock ✓ · Movimientos ✓`, con errores por paso.
- Automática cada 15 / 30 / 60 min **sólo mientras la app está abierta** (no se usan procesos en segundo plano poco fiables del navegador). Para sincronización 24/7 hace falta el backend.
- Cada movimiento local tiene `idempotencyKey` único (índice único en IndexedDB): pedido+ítem, conteo+producto, `ext:maxirest:mov:<id>`, etc. Nunca se aplica dos veces.
- **Sync Queue** (`syncJobs`): `Pendiente · Sincronizado · Error`, con *Reintentar*. Cada trabajo lleva `Idempotency-Key` hacia el gateway.
- Offline: se puede consultar, contar, registrar movimientos y crear pedidos. Los ajustes sincronizados quedan *pendientes* y aparece *“Movimientos pendientes de sincronizar: N — Sincronizar pendientes”*; al volver la conexión se reintentan.
- Errores: en lugar de `500 Internal Server Error` se muestra *“No fue posible actualizar el stock en Maxirest. Quedó pendiente y podrá reintentarse.”* El detalle técnico queda en “Detalle técnico”.

## 7. Ajustes y conciliación

- **Ajuste local**: sólo Stock Manager.
- **Ajuste sincronizado**: Stock Manager → Maxirest, siempre con confirmación previa (*Stock Maxirest · Conteo · Diferencia · ¿Confirmar ajuste?*). Disponible sólo si la conexión declara `createStockAdjustment: supported` (hoy: sólo el mock).
- **Conciliación**: Producto · Stock Maxirest · Stock Stock Manager · Diferencia · Estado, con filtros *iguales, diferencias positivas, negativas, no vinculados, errores*.
- Flujo de inventario: `Maxirest → Stock Manager → Conteo físico → Comparación → Diferencia → Confirmación → Maxirest` (el último paso, por Excel manual hasta que Maxirest habilite escritura).

## 8. Excel Bridge

### Maxirest → Excel → Stock Manager

1. **(Maxirest, manual)** Menú → Stock → Inventarios → Nuevo → fecha, turno y depósito → *Preparar inventario* → exportar a Excel.
2. **(Manual)** Si el archivo es `.xls`, abrirlo en Excel y guardarlo como `.xlsx` (o `.csv`).
3. **(Stock Manager)** Integraciones → Excel Bridge → *Importar Excel de Maxirest*. Se detectan columnas (código, nombre/insumo, unidad, stock actual, conteo, depósito, rubro) y **el usuario confirma o corrige** el mapeo con vista previa.
4. Se guardan como copia externa (código de insumo = identificador). Luego *Vínculos* y *Conciliación*.

### Stock Manager → Excel → Maxirest

1. **(Stock Manager)** En un conteo: *Excel para Maxirest* (o *Exportar stock para Maxirest*). Columnas: Código · Insumo · Unidad · Stock Maxirest · Conteo · Diferencia, más una hoja *Instrucciones*.
2. **(Maxirest, manual)** Inventarios → Nuevo → *Preparar inventario* → cargar la columna “conteo” según el Excel.
3. **(Maxirest, manual)** Revisar diferencias, tildar *Ajuste automático de stock*, elegir concepto y guardar.

> Si tu versión de Maxirest permite importar ese Excel directamente, probalo primero con un inventario de prueba: el formato de importación no está documentado.

## 9. Habilitación: qué pedirle a Maxirest

1. ¿Existe una API / web service para terceros (o acceso como partner)? Documentación, ambiente de pruebas y términos.
2. Método de autenticación y alcance por local/depósito.
3. Lectura: insumos, rubros, unidades, depósitos, stock por depósito, movimientos (con ID estable).
4. Escritura: ajuste de stock con concepto, carga de inventario, idempotencia.
5. Plantilla oficial de importación de inventarios por Excel (columnas exactas).
6. Límites de uso y costos.

## 10. Pruebas

| Test | Cómo | Estado |
|---|---|---|
| 1 Conexión · 2 Autenticación | Requiere acceso real | **Pendiente (sin API)** |
| 3–7 Insumos, rubros, unidades, depósitos, stock | Mock: `tests/unit/integrations.test.ts`, `tests/e2e/maxirest-mock.spec.ts` | Simulado ✓ |
| 8 Mapeo de producto | Unit + E2E (sugerencia, sin duplicados) | Simulado ✓ |
| 9 Conteo · 10 Conciliación | E2E (conteo contra Maxirest, conciliación, Excel real CSV) | Simulado ✓ / Excel ✓ |
| 11 Ajuste | E2E ajuste sincronizado con confirmación | Simulado ✓ |
| 12 Anti-duplicación | Unit: claves idempotentes, cola, mock idempotente | ✓ |
| 13 Desconexión | E2E: desconectar no borra datos | ✓ |
| 14 Offline · 15 Pendientes | E2E: error → pendiente → reintento | Simulado ✓ |
| Contrato del gateway | `tests/unit/gateway-contract.test.ts` | ✓ (todo `NOT_SUPPORTED`) |

Cuando exista acceso real: completar `server/gateway-reference/handler.mjs`, marcar cada operación como `supported` **sólo después de verificarla**, actualizar `officialStatus.ts` y este documento.
