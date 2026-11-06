# Facturación electrónica ARCA en Orillas

Orillas emite **facturas, notas de crédito y notas de débito electrónicas (A, B, C y M)** al cobrar las mesas del Salón, con CAE de ARCA (ex AFIP), y las imprime en tickets de 80 mm con el QR oficial.

## Cómo funciona, en una línea

La app arma el comprobante → el **servicio de ARCA** (un Worker de Cloudflare, gratis) lo firma y lo manda a ARCA → ARCA devuelve el **CAE** → la app lo guarda y lo imprime.

```
Celular / compu (Orillas)          Cloudflare Worker "arca"                ARCA
────────────────────────────────         ──────────────────────────               ──────────
Cobrar mesa → arma la factura   ──HTTPS──▶ verifica sesión y permiso   ──SOAP──▶ WSAA (Token/Sign)
  (importes, IVA, receptor,                firma el TRA con el                     WSFEv1 (CAE)
   número reservado)            ◀──────── certificado (secreto)        ◀──────
Guarda CAE, imprime ticket                 guarda el Token en KV
```

- El **certificado y la clave privada** están sólo en Cloudflare como secretos. Nunca llegan a la app.
- La **clave fiscal** de ARCA no se pide ni se guarda nunca.
- Sólo factura quien tenga sesión, sea miembro del espacio de trabajo habilitado y tenga permiso (dueño, administrador, encargado o el permiso “Cobrar y facturar”).

## Qué incluye

| Parte | Dónde |
|---|---|
| Servicio de ARCA (WSAA + WSFEv1) | `workers/arca/worker.js` (un archivo, sin dependencias, para pegar en Cloudflare) |
| Lógica de facturación de la app | `src/services/fiscalService.ts` |
| Tickets de 80 mm (fiscal, pre-cuenta, comanda) | `src/services/printService.ts` |
| Configuración fiscal | Configuración → Configuración fiscal (`src/components/FiscalSettingsSection.tsx`) |
| Cobro de la mesa | Salón → mesa → Cobrar y cerrar (`src/components/salon/ChargeModal.tsx`) |
| Historial, reintentos, notas, registro de ARCA | Salón → Comprobantes (`src/pages/FiscalDocsPage.tsx`) |
| Reglas de la nube (comprobantes inmodificables) | `firestore.rules` (`fiscalDocs`, `fiscalLog`) |
| Pruebas | `tests/unit/arca-worker.test.ts`, `tests/unit/fiscal.test.ts`, `tests/unit/fiscal-print.test.ts`, `tests/e2e/fiscal.spec.ts` |

## Documentos

1. [CONFIGURACION_ARCA.md](CONFIGURACION_ARCA.md): paso a paso completo (ARCA, Cloudflare y la app).
2. [CERTIFICADOS.md](CERTIFICADOS.md): generar, instalar y renovar certificados.
3. [HOMOLOGACION.md](HOMOLOGACION.md): cómo probar en el ambiente de prueba.
4. [PRODUCCION.md](PRODUCCION.md): cómo habilitar facturas reales.
5. [ERRORES_ARCA.md](ERRORES_ARCA.md): errores frecuentes y qué hacer.
6. [ARQUITECTURA_FISCAL.md](ARQUITECTURA_FISCAL.md): detalle técnico.
7. Ejemplos sin credenciales: [configuracion.ejemplo.json](configuracion.ejemplo.json) y `workers/arca/wrangler.toml.example`.

## Estado

- Probado con pruebas automáticas contra una **ARCA simulada**: firma CMS (verificada con OpenSSL), Token en KV, CAE, numeración correlativa, rechazos, caídas de conexión, respuestas perdidas, dos cajas a la vez, notas de crédito, QR e impresión.
- **Falta probarlo contra la homologación real de ARCA**: requiere el certificado de homologación del titular. Ver [HOMOLOGACION.md](HOMOLOGACION.md).
- **No está listo para producción** hasta pasar las pruebas de homologación de la lista de ese documento.
