# Pruebas en homologación

Homologación es el ambiente de prueba de ARCA: los comprobantes **no tienen validez fiscal**. El ticket lo dice en grande (“HOMOLOGACIÓN — COMPROBANTE DE PRUEBA SIN VALIDEZ FISCAL”).

## Preparación

1. Certificado de homologación cargado en Cloudflare (`ARCA_HOMO_CERT`, `ARCA_HOMO_KEY`). Ver [CERTIFICADOS.md](CERTIFICADOS.md).
2. Orillas → Configuración fiscal → Ambiente **Homologación** → **Probar conexión con ARCA**.

En homologación ARCA **no lista los puntos de venta** (FEParamGetPtosVenta no devuelve nada): se puede usar cualquier número, por ejemplo 5.

## Lista de pruebas obligatorias (antes de producción)

Marcar cada una. Todo queda anotado en Comprobantes → **Registro ARCA**.

| # | Prueba | Cómo | Resultado esperado |
|---|---|---|---|
| 1 | Autenticación WSAA | Probar conexión | “Autenticación con ARCA (WSAA) correcta” |
| 2 | Conexión WSFEv1 | Probar conexión | “Servidores de ARCA: aplicación OK, base OK, autenticación OK” |
| 3 | Factura B a consumidor final | Cobrar una mesa → Consumidor final | Autorizada con CAE de 14 números |
| 4 | Factura A a responsable inscripto | Con datos → CUIT de prueba válido → IVA Responsable Inscripto | Factura A autorizada |
| 5 | Numeración correlativa | Emitir 3 seguidas | Números consecutivos (Comprobantes) |
| 6 | Rechazo | Factura A con un CUIT que no existe en el padrón | Queda “Rechazada” con el mensaje de ARCA; no se marca autorizada |
| 7 | Error de conexión | Cortar internet del celular y cobrar | Queda “Sin confirmar” o “Con error”; al volver internet, **Reintentar** la autoriza |
| 8 | Prevención de duplicados | Cobrar, cortar internet justo después de tocar “Cobrar y emitir”, volver y Reintentar | Una sola factura en ARCA (verificar con “Verificar en ARCA”); el mensaje dice “Recuperado” si ya estaba |
| 9 | Nota de crédito | Abrir una factura → Nota de crédito (total y parcial) | NC autorizada, asociada a la factura |
| 10 | Impresión | Imprimir ticket en la impresora térmica de 80 mm | Datos del emisor, número, CAE, vencimiento y QR legibles |
| 11 | QR | Escanear el QR del ticket con el celular | Abre la página de ARCA con los datos del comprobante |
| 12 | Importes | Comparar total del ticket, total de la mesa y Registro ARCA (ImpTotal) | Iguales; neto + IVA = total |
| 13 | Dos cajas a la vez | Dos dispositivos cobran al mismo tiempo | Dos números distintos, sin errores |

Para la prueba 8 se puede usar el modo avión del celular apenas se toca el botón.

## Datos útiles

- Factura A: hace falta un CUIT válido de un responsable inscripto. Usar el de una empresa conocida o el propio.
- El importe a partir del cual hay que identificar a un consumidor final es **$ 10.000.000** (RG 5700/2025). Con montos chicos alcanza con “Consumidor final”.
- La condición frente al IVA del receptor siempre se informa (RG 5616), así no hay rechazos por ese campo.
