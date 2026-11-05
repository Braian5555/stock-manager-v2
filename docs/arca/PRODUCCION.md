# Habilitar producción (facturas reales)

Sólo después de completar **todas** las pruebas de [HOMOLOGACION.md](HOMOLOGACION.md).

## Checklist

1. **Contador:** confirmar condición frente al IVA, concepto (productos / servicios), alícuotas de la carta y si corresponde Factura A o M.
2. **Punto de venta** de producción dado de alta como “RECE para aplicativo y web services”, **sólo para Stock Manager** (Maxirest no lo usa).
3. **Certificado de producción** generado y **relación** “Facturación Electrónica” asignada al computador (ver [CERTIFICADOS.md](CERTIFICADOS.md), punto 3).
4. Cloudflare → secretos `ARCA_PROD_CERT`, `ARCA_PROD_KEY` y `ARCA_PROD_ENABLED = si`.
5. Stock Manager → Configuración fiscal:
   - Ambiente **Producción (facturas reales)** → Guardar (pide confirmación).
   - Punto de venta de producción.
   - **Probar conexión con ARCA**: certificado, CUIT, servidores, autenticación y **punto de venta habilitado** en verde.
6. **Primera factura real:** una venta chica a consumidor final. Revisar el ticket, escanear el QR y usar “Verificar en ARCA”.
7. **Maxirest:** dejar de facturar las mesas del Salón en Maxirest (si no, se factura dos veces).
8. **Personal:** explicar el botón “Cobrar y cerrar”, la opción “Sin factura por ahora” para cuando ARCA no anda, y la pestaña “Para resolver”.

## Durante la operación

- **Para resolver** (Comprobantes) tiene que quedar vacío al cierre del día. Lo que esté “Sin confirmar” se reintenta: se consulta en ARCA antes de pedir otro número, así que no se duplica.
- **Sin facturar**: mesas cobradas con “Sin factura por ahora”. Facturarlas dentro de los 5 días (ARCA no acepta fechas más viejas para productos) y en el mismo mes.
- Un comprobante autorizado **no se modifica ni se borra**. Para anularlo: **Nota de crédito**.

## Volver a homologación

Cambiar el ambiente a Homologación en Configuración fiscal. Los comprobantes ya emitidos en producción quedan como están.
