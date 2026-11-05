# Configuración paso a paso

Hay tres lugares: **ARCA** (con la clave fiscal del titular), **Cloudflare** (el servicio) y **Stock Manager** (los datos del emisor). Todo lo hace el titular o quien él autorice. Nadie más necesita la clave fiscal.

## 0. Antes de empezar

- Clave fiscal **nivel 3** del titular del CUIT.
- Una computadora con OpenSSL (en Windows viene con Git for Windows, en Mac y Linux ya está).
- Cuenta de Cloudflare (la misma del servicio de IA sirve).

## 1. ARCA: punto de venta para Stock Manager

1. Entrar a arca.gob.ar con clave fiscal → **Administración de puntos de venta y domicilios**.
2. Elegir la empresa → **A/B/M de Puntos de venta** → **Agregar**.
3. Número: uno que no se use (por ejemplo 5). Sistema: **RECE para aplicativo y web services** (monotributistas: “Factura Electrónica - Monotributo - Web Services”).
4. Domicilio: el del local. Guardar.

> **Importante:** este punto de venta es **sólo para Stock Manager**. Maxirest no tiene que usarlo nunca, porque compartir un punto de venta mezcla la numeración y ARCA rechaza los comprobantes.

## 2. ARCA: certificados

Ver [CERTIFICADOS.md](CERTIFICADOS.md). Se generan dos:
- uno de **homologación** (para probar);
- uno de **producción**, cuando las pruebas estén bien.

## 3. Cloudflare: el servicio de ARCA

1. Cloudflare → **Workers & Pages** → **Create** → **Worker**. Nombre: `stock-manager-arca` → **Deploy**.
2. **Edit code** → borrar todo → pegar el contenido de `workers/arca/worker.js` → **Deploy**.
3. **KV (para guardar el Token de ARCA):** Storage & Databases → **KV** → **Create** → nombre `arca-ta`.
   Después: el Worker → **Settings** → **Bindings** → **Add** → **KV namespace** → nombre de variable `ARCA_TA` → elegir `arca-ta` → **Deploy**.
4. **Secretos:** el Worker → **Settings** → **Variables and Secrets** → **Add** (tipo **Secret**):

| Nombre | Valor |
|---|---|
| `ARCA_CUIT` | CUIT del emisor, 11 números sin guiones |
| `ARCA_WORKSPACE` | Id del espacio de trabajo: se ve y se copia en Stock Manager → Configuración fiscal |
| `ARCA_HOMO_CERT` | Contenido completo del `.crt` de homologación (desde `-----BEGIN CERTIFICATE-----` hasta `-----END CERTIFICATE-----`) |
| `ARCA_HOMO_KEY` | Contenido completo del `.key` (clave privada, sin contraseña) |
| `ARCA_PROD_CERT` / `ARCA_PROD_KEY` | Lo mismo para producción (después de homologar) |
| `ARCA_PROD_ENABLED` | `si` sólo cuando se habilite producción |

5. Copiar la dirección del Worker (algo como `https://stock-manager-arca.<usuario>.workers.dev`).
6. Abrir esa dirección + `/health` en el navegador: tiene que decir `"homologacion": true` y `"kv": true`.

## 4. Firebase: reglas de la nube

Publicar el `firestore.rules` actualizado (Firebase → Firestore Database → Reglas → Publicar). Agrega los comprobantes (`fiscalDocs`) y el registro de ARCA (`fiscalLog`), y hace que un comprobante autorizado **no se pueda modificar ni borrar**.

## 5. Stock Manager: Configuración fiscal

Configuración → **Configuración fiscal**:

1. Tildar **Facturar desde Stock Manager al cobrar las mesas**.
2. Ambiente: **Homologación (pruebas)**.
3. Dirección del servicio de ARCA: la del paso 3.5.
4. Emisor: CUIT, condición frente al IVA, razón social, domicilio fiscal; opcional: nombre de fantasía, Ingresos Brutos, inicio de actividades.
5. Punto de venta: el del paso 1. Concepto: **Productos** (consultarlo con el contador). IVA por defecto de la carta: normalmente **21%**.
6. **Guardar** → **Probar conexión con ARCA**: todos los controles tienen que quedar en verde.
7. En la **Carta** del Salón, si algún producto lleva otra alícuota (por ejemplo 10,5%), cambiarla en ese producto.

## 6. Permisos

Pueden cobrar y facturar: el dueño y los administradores del espacio, los usuarios **Administrador** y **Encargado**, y los usuarios **Personalizados** con el permiso **Cobrar y facturar**. Los **Mozos** no pueden.
