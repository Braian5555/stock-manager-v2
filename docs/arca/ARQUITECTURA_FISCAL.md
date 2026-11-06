# Arquitectura fiscal

## Componentes

### 1. Servicio de ARCA — `workers/arca/worker.js` (Cloudflare Worker)

Archivo único, sin dependencias (para pegarlo en el editor de Cloudflare). Usa WebCrypto nativo para la firma RSA (no consume el límite de CPU del plan gratis).

- **Sesión y permisos:** verifica el ID token de Firebase (RS256, proyecto, vencimiento), que el espacio sea `ARCA_WORKSPACE`, y con la sesión del usuario lee en Firestore su rol (dueño/administrador del espacio) o su usuario de Stock Manager (Administrador, Encargado o permiso `billing`).
- **WSAA:** arma el TRA (`loginTicketRequest`, servicio `wsfe`, ±10 min), lo firma en **CMS SignedData** (PKCS#7, SHA-256 + RSA, contenido adjunto, atributos firmados contentType/signingTime/messageDigest) y llama a `LoginCms`. Guarda Token/Sign en KV `ARCA_TA` hasta 5 minutos antes de su vencimiento. Ante 600/601 descarta el Token y reintenta una vez.
- **WSFEv1 (SOAP 1.1):** `FEDummy`, `FECompUltimoAutorizado`, `FECompConsultar`, `FECAESolicitar`, `FEParamGetCondicionIvaReceptor`, `FEParamGetPtosVenta`.
- **Validación previa:** totales (neto + IVA + otros = total), alícuotas e importes de IVA, letra vs. receptor (A/M requieren CUIT y condición RI/monotributo), consumidor final ≥ $ 10.000.000 identificado, fechas (±5 días productos, ±10 servicios), CUIT con dígito verificador, comprobante asociado en notas.
- **Registro:** cada llamada devuelve `log` (operación, hora, duración, pedido y respuesta) con Token, Sign y CMS reemplazados por `***`.

Rutas (todas POST salvo `/health`): `/health`, `/status`, `/last`, `/emit`, `/consult`, `/params`.

### 2. App — `src/services/fiscalService.ts`

- **Tipo de comprobante:** emisor RI → A (o M) a RI y monotributistas (condiciones 1, 6, 13, 16), B al resto; emisor monotributo/exento → C.
- **Importes:** los precios de la carta incluyen IVA. Por alícuota: `base = round2(total / (1 + alícuota))`, `iva = total − base`. Así neto + IVA = total exacto.
- **Comprobante (`FiscalDoc`):** guarda una copia del emisor y del receptor, líneas, importes, estado, intento, CAE y vencimiento.
- **Registro (`FiscalLogEntry`):** cada pedido/respuesta, para auditoría.

### 3. Nube — `firestore.rules`

- `fiscalDocs`: los miembros leen y crean; **un comprobante autorizado no se puede modificar ni borrar** (sólo reenviar idéntico).
- `fiscalLog`: sólo se agrega.

## Cómo se evita duplicar facturas

El riesgo: se pide el CAE, ARCA lo autoriza, pero la respuesta no llega. Si se vuelve a pedir, quedan dos facturas.

1. Antes de enviar, la app **reserva y anota** en el comprobante el número a pedir (`attempt.nro = último + 1`) y lo sincroniza.
2. El Worker vuelve a consultar el último autorizado:
   - si `nro ≤ último`, **consulta ese número** en ARCA: si es este comprobante (mismo total y receptor) devuelve **ese CAE** (“Recuperado”); si es otro, pide renumerar;
   - si `nro = último + 1`, pide el CAE;
   - si no, pide renumerar.
3. Si la respuesta se corta → **“Sin confirmar”**. El reintento usa el mismo número, así que entra por la consulta del punto 2.
4. Si otro dispositivo usó el número (error 10016), se renumera y se reintenta (hasta 4 veces).
5. La app nunca marca “autorizada” sin un CAE de 14 dígitos devuelto por ARCA.

Límite conocido: si dos comprobantes con **el mismo total y el mismo receptor** compiten por el mismo número y uno de ellos pierde la respuesta, la recuperación no los puede distinguir. La app además descarta un número que ya tenga otro comprobante autorizado localmente. Es un caso muy poco probable; se recomienda que facture un solo dispositivo por punto de venta.

## Flujo de una mesa

1. Mozo abre la mesa y carga lo consumido (Salón).
2. Se manda a cocina; cocina marca listo.
3. **Pidió la cuenta** → **Cobrar y cerrar**.
4. Medios de pago (se puede dividir; vuelto en efectivo).
5. Cliente: consumidor final, con datos (CUIT/DNI/CUIL + condición IVA) o “Sin factura por ahora”.
6. La app calcula importes e IVA → servicio de ARCA → CAE.
7. Se guarda el comprobante; la mesa se cierra **sin pasar a Maxirest**.
8. Imprimir ticket fiscal (80 mm, QR).

Si ARCA no responde, la mesa se cierra igual (ya se cobró) y el comprobante queda en **Para resolver**.

### Cuenta dividida y descuentos

- **Partes iguales o por ítems:** cada parte es un cobro (`TicketCharge`) con sus pagos, propina y su propia factura. Las líneas de una parte igual van en proporción (cantidades fraccionarias) y la última parte cubre el resto exacto.
- **Descuento** (% o monto) y **cortesías:** la factura lleva las líneas a precio de carta y la diferencia como **bonificación**; el importe facturado (y el IVA por alícuota) es el cobrado. Las notas de crédito respetan la misma proporción.
- **Propina:** va a la caja, no se factura.
- **Caja:** cada cobro queda en la caja abierta (`cashSessions`); si no hay, entra en la próxima que se abra.

## Impresión — `src/services/printService.ts`

- **Ticket fiscal:** emisor, CUIT, IIBB, domicilio, inicio de actividades, condición IVA; tipo, código, punto de venta, número, fecha; receptor; detalle; neto e IVA (A/M) o “Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)” con IVA contenido (B); total; pagos; CAE y vencimiento; QR oficial (`https://www.arca.gob.ar/fe/qr/?p=<JSON base64>`).
- **Pre-cuenta** y **comanda**: llevan “NO VÁLIDO COMO FACTURA”.
- Se imprime con el diálogo del navegador (`@page size: 80mm`). La impresora térmica tiene que estar instalada en el dispositivo.

## Fuera de alcance (por ahora)

- Factura E (exportación), FCE MiPyME, percepciones/tributos, moneda extranjera, CAEA (contingencia).
- Consulta automática del padrón de ARCA para completar los datos del cliente (requiere otro servicio de ARCA).
